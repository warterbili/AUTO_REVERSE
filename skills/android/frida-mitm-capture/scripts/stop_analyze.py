#!/usr/bin/env python3
"""
stop_analyze.py — Phase 2: Stop capture and analyze the results

Steps:
  1. Read session.info (PIDs, package name, port)
  2. Terminate Frida and mitmproxy
  3. Clear the device proxy
  4. Parse captured.jsonl
  5. Print the analysis report

Usage:
  python stop_analyze.py -o /tmp/mitm_session
  python stop_analyze.py -o /tmp/mitm_session --full     # show full request bodies
  python stop_analyze.py -o /tmp/mitm_session --filter /api/order  # view a single path only
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path


# ── Cross-platform constants and helpers ────────────────────────────────
IS_WIN = os.name == "nt"
DEFAULT_SESSION = os.path.join(tempfile.gettempdir(), "mitm_session")


def _enable_ansi():
    """Windows 10+ consoles don't parse ANSI color codes by default; enable VT processing manually."""
    if IS_WIN:
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetConsoleMode(k.GetStdHandle(-11), 7)
        except Exception:
            pass


def _kill_pid(pid):
    """Cross-platform process kill: Windows uses taskkill /T to take down the child process tree, POSIX uses SIGTERM."""
    try:
        if IS_WIN:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(int(pid))],
                           capture_output=True)
        else:
            os.kill(int(pid), signal.SIGTERM)
        return True
    except ProcessLookupError:
        return False
    except Exception:
        return False


def _kill_by_name(name):
    """Cross-platform fallback cleanup by process name."""
    if IS_WIN:
        exe = name if name.lower().endswith(".exe") else name + ".exe"
        subprocess.run(["taskkill", "/F", "/IM", exe], capture_output=True)
    else:
        subprocess.run(["pkill", "-f", name], capture_output=True)


# ── ANSI colors ──────────────────────────────────────
def c(color, text):
    codes = {"green": "\033[92m", "yellow": "\033[93m", "red": "\033[91m",
             "cyan": "\033[96m", "bold": "\033[1m", "dim": "\033[2m",
             "magenta": "\033[95m", "reset": "\033[0m"}
    return codes.get(color, "") + str(text) + codes["reset"]


def banner(msg):
    print(c("bold", f"\n{'═'*60}"))
    print(c("bold", f"  {msg}"))
    print(c("bold", f"{'═'*60}"))


# ── Stop processes ──────────────────────────────────────
def stop_processes(session_dir: Path):
    info_file = session_dir / "session.info"
    if not info_file.exists():
        print(c("yellow", "  ⚠ session.info not found, skipping process cleanup"))
        return

    info = {}
    for line in info_file.read_text().strip().split("\n"):
        if "=" in line:
            k, v = line.split("=", 1)
            info[k.strip()] = v.strip()

    port = info.get("port", "8080")

    for key in ("frida_pid", "mitm_pid"):
        pid = info.get(key)
        if pid:
            if _kill_pid(pid):
                print(c("green", f"  ✓ Stopped {key} (PID {pid})"))
            else:
                print(c("dim", f"  ℹ {key} (PID {pid}) already stopped or unkillable"))

    # Also kill by name (fallback) — Windows: taskkill /IM, POSIX: pkill -f
    for name in ("mitmdump", "frida"):
        _kill_by_name(name)

    # Clear the device proxy
    subprocess.run(["adb", "shell", "settings", "delete", "global", "http_proxy"],
                   capture_output=True)
    subprocess.run(["adb", "shell", "settings", "put", "global", "http_proxy", ":0"],
                   capture_output=True)
    try:
        subprocess.run(["adb", "reverse", "--remove", f"tcp:{port}"], capture_output=True)
    except Exception:
        pass
    print(c("green", "  ✓ Device proxy cleared"))


# ── Analyze JSONL ─────────────────────────────────────
def analyze(session_dir: Path, full: bool = False, path_filter: str = None):
    jsonl = session_dir / "captured.jsonl"
    if not jsonl.exists() or jsonl.stat().st_size == 0:
        print(c("red", "\n✗ No captured data found."))
        print(c("dim", f"  Expected: {jsonl}"))
        return

    records = []
    with open(jsonl, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass

    if not records:
        print(c("yellow", "\n⚠ captured.jsonl is empty or unreadable."))
        return

    # ── Apply filter ──
    if path_filter:
        records = [r for r in records if path_filter in r["request"]["path"]]
        print(c("dim", f"\n  Filter: {path_filter} → {len(records)} matches"))

    banner(f"📊 Analysis report — {len(records)} requests")

    # ── 1. Endpoint statistics ──────────────────────────────
    print(c("bold", "\n🔗 Endpoint list"))
    endpoint_map = defaultdict(list)
    for r in records:
        req = r["request"]
        key = f"{req['method']:6s} {req['path'].split('?')[0]}"
        endpoint_map[key].append(r)

    for ep, ep_records in sorted(endpoint_map.items(), key=lambda x: -len(x[1])):
        statuses = [str(r["response"]["status"]) for r in ep_records]
        status_summary = ", ".join(sorted(set(statuses)))
        status_color = "green" if all(s.startswith("2") for s in statuses) else "yellow"
        print(f"  {c('cyan', ep):50s} ×{len(ep_records):3d}  [{c(status_color, status_summary)}]")

    # ── 2. Auth / key headers ────────────────────────
    all_auth_headers = {}
    for r in records:
        for k, v in r["analysis"]["auth_headers"].items():
            if k not in all_auth_headers:
                all_auth_headers[k] = v

    if all_auth_headers:
        print(c("bold", "\n🔑 Auth / key request headers"))
        for k, v in all_auth_headers.items():
            print(f"  {c('cyan', k)}: {v}")

    # ── 3. Encrypted fields ──────────────────────────────
    all_enc = []
    for r in records:
        for ef in r["analysis"]["encrypted_fields"]:
            ef["endpoint"] = f"{r['request']['method']} {r['request']['path'].split('?')[0]}"
            all_enc.append(ef)

    if all_enc:
        print(c("bold", "\n⚠️  Suspected encrypted / hashed fields"))
        seen = set()
        for ef in all_enc:
            key = (ef["endpoint"], ef["location"])
            if key not in seen:
                seen.add(key)
                print(f"  {c('yellow', ef['endpoint'][:50]):52s} "
                      f"{c('cyan', ef['location'][:30]):32s} → {c('magenta', ef['type'])}")
                print(c("dim", f"    Preview: {ef['preview']}"))

    # ── 4. Per-request details ───────────────────────────
    print(c("bold", f"\n📝 Request details ({len(records)} total)"))
    for r in records:
        req = r["request"]
        res = r["response"]
        status = res["status"]
        status_color = "green" if 200 <= status < 300 else "yellow" if 300 <= status < 400 else "red"

        seq_tag = c("bold", f"[#{r['seq']}]")
        print(f"\n  {seq_tag} "
              f"{c('cyan', req['method'])} "
              f"{c(status_color, str(status))} "
              f"{req['host']}{req['path'][:80]}")

        # Request headers (show non-standard headers only)
        interesting_headers = {
            k: v for k, v in req["headers"].items()
            if k.lower() not in ("content-type", "content-length", "accept-encoding",
                                  "user-agent", "accept", "host", "connection")
        }
        if interesting_headers:
            print(c("dim", "    Headers:"))
            for k, v in list(interesting_headers.items())[:6]:
                print(c("dim", f"      {k}: {v[:80]}"))

        # Request body
        body = req.get("body_json") or req.get("body_text", "")
        if body:
            body_str = json.dumps(body, ensure_ascii=False, indent=2) if isinstance(body, dict) else str(body)
            if not full:
                body_str = body_str[:300] + ("..." if len(body_str) > 300 else "")
            print(c("dim", f"    Body: {body_str}"))

        # Response body
        res_body = res.get("body_json") or res.get("body_text", "")
        if res_body:
            res_str = json.dumps(res_body, ensure_ascii=False, indent=2) if isinstance(res_body, dict) else str(res_body)
            if not full:
                res_str = res_str[:400] + ("..." if len(res_str) > 400 else "")
            print(c("dim", f"    Response: {res_str}"))

    # ── 5. Save the analysis results ──────────────────────────
    report_path = session_dir / "analysis.json"
    report = {
        "total_requests": len(records),
        "endpoints": {ep: len(recs) for ep, recs in endpoint_map.items()},
        "auth_headers": all_auth_headers,
        "encrypted_fields": [{"endpoint": ef["endpoint"], "location": ef["location"],
                               "type": ef["type"]} for ef in all_enc],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(c("dim", f"\n  Analysis saved: {report_path}"))
    print(c("dim", f"  Raw data: {jsonl}"))
    print(c("green", "\n✅ Analysis complete.\n"))


# ── Main flow ────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Frida MITM capture — Phase 2: stop + analyze")
    parser.add_argument("-o", "--output", default=DEFAULT_SESSION, help="session directory")
    parser.add_argument("--full", action="store_true", help="show full request/response bodies")
    parser.add_argument("--filter", default=None, help="analyze only paths containing this string")
    parser.add_argument("--no-stop", action="store_true", help="analyze only, don't stop processes")
    args = parser.parse_args()

    _enable_ansi()

    session_dir = Path(args.output)
    if not session_dir.exists():
        print(c("red", f"✗ Session directory not found: {session_dir}"))
        sys.exit(1)

    banner("Frida MITM stop + analyze")

    if not args.no_stop:
        print(c("bold", "\n[1/2] Stopping processes and clearing proxy..."))
        stop_processes(session_dir)
        time.sleep(0.5)

    print(c("bold", "\n[2/2] Analyzing captured traffic..."))
    analyze(session_dir, full=args.full, path_filter=args.filter)


if __name__ == "__main__":
    main()
