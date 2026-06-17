#!/usr/bin/env python3
"""
frida_server.py — auto_reverse adapter: ensure frida-server is running on the device.

Detection order: adb device -> is frida-ps -U already connected -> otherwise locate the frida-server binary
-> push to /data/local/tmp -> chmod -> start in the background via su -> verify again.
Emits JSON with a unified schema (status/findings/open_questions).

frida-server binary location priority:
  1) --bin argument
  2) $FRIDA_SERVER_BIN
  3) $AUTO_REVERSE_TOOLS/frida/frida-server
Note: if frida-server is already running on the device, this adapter returns ok without needing the binary path.
The version/architecture must match the host frida and the device abi (e.g. arm64-v8a).

Usage:
  python frida_server.py [--bin <frida-server path>] [--device <serial>] [--remote-path /data/local/tmp/frida-server]
Cross-platform (invokes adb/frida via subprocess list arguments, bypassing the shell so paths are not rewritten).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

REMOTE_DEFAULT = "/data/local/tmp/frida-server"


def sh(args, timeout=20):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return 1, str(e)


def find_adb():
    return shutil.which("adb")


def adb_base(serial):
    base = ["adb"]
    if serial:
        base += ["-s", serial]
    return base


def device_serial(explicit):
    if explicit:
        return explicit
    code, out = sh(["adb", "devices"])
    devs = [l.split("\t")[0] for l in out.splitlines()[1:]
            if l.strip() and "\tdevice" in l]
    return devs[0] if devs else None


def frida_connected():
    """If frida-ps -U can list processes, frida-server is considered running."""
    code, out = sh(["frida-ps", "-U"], timeout=15)
    ok = code == 0 and "PID" in out
    return ok, out.strip().splitlines()[:4]


def locate_binary(cli_bin):
    cands = [
        cli_bin,
        os.environ.get("FRIDA_SERVER_BIN"),
        os.path.join(os.environ.get("AUTO_REVERSE_TOOLS", ""), "frida", "frida-server")
        if os.environ.get("AUTO_REVERSE_TOOLS") else None,
    ]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def main():
    ap = argparse.ArgumentParser(description="ensure frida-server is running on the device")
    ap.add_argument("--bin", default=None, help="frida-server binary path")
    ap.add_argument("--device", default=None, help="adb serial")
    ap.add_argument("--remote-path", default=REMOTE_DEFAULT)
    args = ap.parse_args()

    findings, oq = [], []

    if not find_adb():
        print(json.dumps({"phase": "frida_server", "status": "blocked",
                          "open_questions": ["adb not on PATH; install platform-tools first"]},
                         ensure_ascii=False, indent=2))
        sys.exit(1)

    serial = device_serial(args.device)
    if not serial:
        print(json.dumps({"phase": "frida_server", "status": "blocked",
                          "open_questions": ["no connected device, adb devices is empty; check USB/authorization"]},
                         ensure_ascii=False, indent=2))
        sys.exit(1)
    findings.append(f"device={serial}")

    # already running?
    ok, sample = frida_connected()
    if ok:
        result = {"phase": "frida_server", "status": "ok",
                  "findings": findings + ["frida-server already running, frida-ps -U connected"],
                  "sample_procs": sample, "open_questions": []}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # locate the binary
    binpath = locate_binary(args.bin)
    if not binpath:
        result = {"phase": "frida_server", "status": "blocked", "findings": findings,
                  "open_questions": ["frida-server binary not found; specify it with --bin, or set FRIDA_SERVER_BIN / "
                                     "$AUTO_REVERSE_TOOLS/frida/frida-server. Download: "
                                     "https://github.com/frida/frida/releases (frida-server-<ver>-android-arm64.xz)"]}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(1)
    findings.append(f"frida-server bin={binpath}")

    b = adb_base(serial)
    # push + chmod
    sh(b + ["push", binpath, args.remote_path], timeout=120)
    sh(b + ["shell", "su", "-c", f"chmod 755 {args.remote_path}"])
    # start in the background (nohup + & to keep it alive after the adb shell exits)
    sh(b + ["shell", "su", "-c", f"nohup {args.remote_path} >/dev/null 2>&1 &"], timeout=10)

    # poll to verify
    for _ in range(5):
        time.sleep(1.5)
        ok, sample = frida_connected()
        if ok:
            break

    if ok:
        result = {"phase": "frida_server", "status": "ok",
                  "findings": findings + ["pushed and started frida-server, frida-ps -U connected"],
                  "sample_procs": sample, "open_questions": []}
    else:
        oq.append("pushed/started but frida-ps -U still not connecting: check whether the frida-server version "
                  "matches the host frida, whether the architecture matches the device abi, and whether SELinux/anti-detection is blocking it")
        result = {"phase": "frida_server", "status": "blocked",
                  "findings": findings, "open_questions": oq}

    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
