#!/usr/bin/env python3
"""
start_capture.py — Phase 1: Start a MITM capture session

Steps:
  1. Detect the ADB device
  2. Start mitmproxy (in the background)
  3. Set the device proxy
  4. Frida-spawn the target app (injecting the SSL bypass)
  5. Print "App ready" and wait for the user's action
  6. When the user is done, run: python stop_analyze.py -o <session_dir>

Usage:
  python start_capture.py -p com.example.app
  python start_capture.py -p com.example.app -o /tmp/my_session --port 8080 --host 127.0.0.1
"""

import argparse
import subprocess
import sys
import time
import signal
import os
import tempfile
from pathlib import Path


# ── Cross-platform constants ──────────────────────────────────────
IS_WIN = os.name == "nt"
# Windows has no /tmp; use the system temp directory uniformly
DEFAULT_SESSION = os.path.join(tempfile.gettempdir(), "mitm_session")


def _enable_ansi():
    """Windows 10+ consoles don't parse ANSI color codes by default; enable VT processing manually."""
    if IS_WIN:
        try:
            import ctypes
            k = ctypes.windll.kernel32
            # ENABLE_PROCESSED_OUTPUT | ENABLE_WRAP_AT_EOL_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING
            k.SetConsoleMode(k.GetStdHandle(-11), 7)
        except Exception:
            pass


# ── ANSI colors ──────────────────────────────────────
def c(color, text):
    codes = {"green": "\033[92m", "yellow": "\033[93m", "red": "\033[91m",
             "cyan": "\033[96m", "bold": "\033[1m", "dim": "\033[2m", "reset": "\033[0m"}
    return codes.get(color, "") + str(text) + codes["reset"]


def banner(msg):
    print(c("bold", f"\n{'─'*55}"))
    print(c("bold", f"  {msg}"))
    print(c("bold", f"{'─'*55}"))


# ── ADB helpers ──────────────────────────────────────
def check_adb_device():
    result = subprocess.run(["adb", "devices"], capture_output=True, text=True)
    lines = [l.strip() for l in result.stdout.strip().split("\n")[1:]
             if l.strip() and "offline" not in l and "\t" in l]
    if not lines:
        raise RuntimeError("No ADB device found. Connect device and run: adb devices")
    device_id = lines[0].split("\t")[0]
    return device_id


def adb_shell(cmd, check=False):
    full = ["adb", "shell"] + cmd if isinstance(cmd, list) else ["adb", "shell", cmd]
    return subprocess.run(full, capture_output=True, text=True, check=check)


def set_device_proxy(host, port):
    """Set the device WiFi proxy (requires root or Android 6+)."""
    proxy_str = f"{host}:{port}"
    adb_shell(["settings", "put", "global", "http_proxy", proxy_str])
    # Verify
    r = adb_shell(["settings", "get", "global", "http_proxy"])
    if proxy_str in r.stdout:
        print(c("green", f"  ✓ Device proxy set → {proxy_str}"))
    else:
        print(c("yellow", f"  ⚠ Could not verify proxy. Try manual setup or USB reverse."))
        print(c("yellow", f"    Tip: adb reverse tcp:{port} tcp:{port}"))


def check_frida_server():
    """Check whether frida-server is running on the device."""
    # On Android 8+, ps lists only the current shell's processes by default; -A is needed to list them all
    r = adb_shell("ps -A | grep -E 'frida-server|fff'")
    if "frida-server" in r.stdout or "fff" in r.stdout:
        print(c("green", "  ✓ frida-server is running on device"))
        return True
    else:
        print(c("yellow", "  ⚠ frida-server not detected. Attempting to start..."))
        # Try to start it from common paths
        for path in ["/data/local/tmp/frida-server", "/data/local/tmp/fff"]:
            adb_shell(f"chmod +x {path} 2>/dev/null; {path} &")
            time.sleep(1)
            r2 = adb_shell("ps -A | grep frida-server")
            if "frida-server" in r2.stdout or path.split("/")[-1] in r2.stdout:
                print(c("green", f"  ✓ Started frida-server from {path}"))
                return True
        print(c("red", "  ✗ Could not start frida-server. Please start manually:"))
        print(c("red", "    adb shell /data/local/tmp/frida-server &"))
        return False


# ── mitmproxy ─────────────────────────────────────
def start_mitmproxy(session_dir: Path, port: int) -> subprocess.Popen:
    addon_path = Path(__file__).parent / "mitm_addon.py"
    if not addon_path.exists():
        raise RuntimeError(f"mitm_addon.py not found at {addon_path}")

    cmd = [
        "mitmdump",
        "--listen-port", str(port),
        "-s", str(addon_path),
        "--set", f"session_dir={session_dir}",
        "--set", "ssl_insecure=true",
        "-q",
    ]

    log_file = open(session_dir / "mitmproxy.log", "w")
    proc = subprocess.Popen(cmd, stdout=log_file, stderr=log_file)
    time.sleep(1.5)

    if proc.poll() is not None:
        log_file.close()
        log = (session_dir / "mitmproxy.log").read_text()
        raise RuntimeError(f"mitmproxy failed to start.\n{log}")

    print(c("green", f"  ✓ mitmproxy started (PID {proc.pid}) on port {port}"))
    return proc


# ── Frida ─────────────────────────────────────────
def frida_spawn(package: str, ssl_bypass_js: Path, session_dir: Path) -> subprocess.Popen:
    if not ssl_bypass_js.exists():
        raise RuntimeError(f"ssl_bypass.js not found at {ssl_bypass_js}")

    cmd = [
        "frida",
        "-U",
        "-f", package,
        "-l", str(ssl_bypass_js),
    ]

    log_file = open(session_dir / "frida.log", "w")
    proc = subprocess.Popen(cmd, stdout=log_file, stderr=log_file)
    time.sleep(3)  # wait for the app to start

    if proc.poll() is not None:
        log_file.close()
        log = (session_dir / "frida.log").read_text()
        raise RuntimeError(f"Frida failed.\n{log[-500:]}")

    print(c("green", f"  ✓ App spawned via Frida (PID {proc.pid})"))
    return proc


# ── USB reverse-proxy notes ──────────────────────────────
def setup_usb_reverse(port: int):
    """USB mode: reverse-forward the device's port to the host's port."""
    r = subprocess.run(["adb", "reverse", f"tcp:{port}", f"tcp:{port}"],
                       capture_output=True, text=True)
    if r.returncode == 0:
        print(c("green", f"  ✓ USB reverse: device:{port} → host:{port}"))
        return True
    return False


# ── Main flow ────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Frida MITM capture — Phase 1: start")
    parser.add_argument("-p", "--package", required=True, help="target app package name")
    parser.add_argument("-o", "--output", default=DEFAULT_SESSION, help="session directory")
    parser.add_argument("--port", type=int, default=8080, help="mitmproxy port")
    parser.add_argument("--host", default="127.0.0.1",
                        help="proxy host IP (use the real IP on a LAN, 127.0.0.1 over USB)")
    parser.add_argument("--usb-reverse", action="store_true", default=True,
                        help="automatically set up adb reverse (USB mode, enabled by default)")
    args = parser.parse_args()

    _enable_ansi()

    session_dir = Path(args.output)
    session_dir.mkdir(parents=True, exist_ok=True)
    ssl_bypass_js = Path(__file__).parent / "ssl_bypass.js"

    banner("Frida MITM capture startup")
    print(f"  Package : {c('cyan', args.package)}")
    print(f"  Session : {c('cyan', str(session_dir))}")
    print(f"  Proxy   : {c('cyan', f'{args.host}:{args.port}')}")

    mitm_proc = None
    frida_proc = None

    try:
        # 1. ADB detection
        print(c("bold", "\n[1/5] Checking ADB device..."))
        device = check_adb_device()
        print(c("green", f"  ✓ Device: {device}"))

        # 2. USB reverse proxy (preferred, no WiFi dependency)
        print(c("bold", "\n[2/5] Setting up proxy routing..."))
        if args.usb_reverse:
            ok = setup_usb_reverse(args.port)
            if ok:
                args.host = "127.0.0.1"  # the device hits its own lo -> via adb reverse -> the host

        set_device_proxy(args.host, args.port)

        # 3. Check frida-server
        print(c("bold", "\n[3/5] Checking frida-server..."))
        check_frida_server()

        # 4. Start mitmproxy
        print(c("bold", "\n[4/5] Starting mitmproxy..."))
        mitm_proc = start_mitmproxy(session_dir, args.port)

        # 5. Frida spawn
        print(c("bold", "\n[5/5] Spawning app with SSL bypass..."))
        frida_proc = frida_spawn(args.package, ssl_bypass_js, session_dir)

        # Save the PIDs for stop_analyze.py to use
        (session_dir / "session.info").write_text(
            f"package={args.package}\n"
            f"port={args.port}\n"
            f"host={args.host}\n"
            f"mitm_pid={mitm_proc.pid}\n"
            f"frida_pid={frida_proc.pid}\n"
        )

        # ── Success; wait for the user's action ────────────────────
        print("\n" + "=" * 55)
        print(c("green", "✅ App is ready! Traffic is being captured."))
        print()
        print(c("bold", "👉 Perform the action you want to capture on the phone."))
        print(c("bold", "   When done, tell Claude \"done\" or \"好了\"."))
        print()
        print(c("dim", f"   Live log: {session_dir}/captured.jsonl"))
        print(c("dim", f"   When done, run: python stop_analyze.py -o {session_dir}"))
        print("=" * 55)

    except Exception as e:
        print(c("red", f"\n✗ Error: {e}"))
        _cleanup(mitm_proc, frida_proc, args.port)
        sys.exit(1)


def _cleanup(mitm_proc, frida_proc, port):
    """Emergency cleanup."""
    if frida_proc:
        try:
            frida_proc.terminate()
        except Exception:
            pass
    if mitm_proc:
        try:
            mitm_proc.terminate()
        except Exception:
            pass
    # Clear the proxy
    subprocess.run(["adb", "shell", "settings", "delete", "global", "http_proxy"],
                   capture_output=True)
    subprocess.run(["adb", "shell", "settings", "put", "global", "http_proxy", ":0"],
                   capture_output=True)


if __name__ == "__main__":
    main()
