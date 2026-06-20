#!/usr/bin/env python3
"""
doctor.py — comprehensively scan the local machine for installed/missing reversing tools.

Resolution order: project venv -> project tools/bin -> system PATH (skip re-download if already present).
On-demand philosophy: no need to install everything at once; fetch a missing tool only when it is
actually needed via `python tools/fetch.py <id>`.

Usage:
  python tools/doctor.py                 # full checkup
  python tools/doctor.py --domain android
  python tools/doctor.py --json          # for the brain/scripts to consume
  python tools/doctor.py --missing       # list only missing tools + their fetch commands
Cross-platform, zero third-party dependencies.
"""
import argparse
import json
import subprocess
import sys

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from _toolspec import TOOLS, resolve, OSKEY, PROJECT_ROOT  # noqa: E402

PRESENT = {"present-venv", "present-bin", "present-path", "present-venv?", "present-device"}


def frida_server_on_device():
    """frida-server is a device-side binary, not a host tool. If an adb device has it
    running, report that instead of a misleading 'missing' (it lives on the phone)."""
    try:
        devs = subprocess.run(["adb", "devices"], capture_output=True, text=True, timeout=8)
        lines = [l for l in devs.stdout.splitlines()[1:] if "\tdevice" in l]
        if not lines:
            return None
        serial = lines[0].split("\t")[0]
        ps = subprocess.run(["adb", "-s", serial, "shell", "pidof", "frida-server"],
                            capture_output=True, text=True, timeout=8)
        pid = ps.stdout.strip()
        return f"running on device {serial} (pid {pid})" if pid else None
    except Exception:
        return None


def scan(domain=None):
    rows = []
    for tid, spec in TOOLS.items():
        if domain and spec.get("domain") != domain:
            continue
        if spec.get("os") and OSKEY not in spec["os"]:
            continue  # tool not applicable to the current OS (e.g. GDA is Windows-only)
        status, loc = resolve(tid)
        if tid == "frida-server" and status not in PRESENT:
            dev = frida_server_on_device()
            if dev:
                status, loc = "present-device", dev
        rows.append({"id": tid, "domain": spec.get("domain"), "kind": spec["kind"],
                     "status": status, "location": loc, "present": status in PRESENT,
                     "optional": spec.get("optional", False), "alt": spec.get("alt", []),
                     "url": spec.get("url"), "note": spec.get("note")})
    return rows


def alt_ok(row, by_id):
    return any(by_id.get(a, {}).get("present") for a in row["alt"])


def main():
    ap = argparse.ArgumentParser(description="Reversing toolchain checkup")
    ap.add_argument("--domain", default=None, help="restrict to one domain (runtime/android/native/web)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--missing", action="store_true", help="list only missing tools + their fetch commands")
    args = ap.parse_args()

    rows = scan(args.domain)
    by_id = {r["id"]: r for r in rows}

    if args.json:
        print(json.dumps({"os": OSKEY, "project_root": str(PROJECT_ROOT), "tools": rows},
                         ensure_ascii=False, indent=2))
        return

    C = {"g": "\033[92m", "y": "\033[93m", "r": "\033[91m", "c": "\033[96m",
         "d": "\033[2m", "b": "\033[1m", "x": "\033[0m"}
    if OSKEY == "win":
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetConsoleMode(k.GetStdHandle(-11), 7)
        except Exception:
            pass

    present = sum(1 for r in rows if r["present"])
    print(f"{C['b']}Reversing toolchain checkup — OS={OSKEY} — project={PROJECT_ROOT}{C['x']}")
    print(f"{C['b']}Ready {present}/{len(rows)}{C['x']}\n")

    cur = None
    miss = []
    for r in sorted(rows, key=lambda x: (x["domain"] or "", x["id"])):
        if args.missing and r["present"]:
            continue
        if r["domain"] != cur:
            cur = r["domain"]
            print(f"{C['c']}[{cur}]{C['x']}")
        if r["present"]:
            print(f"  {C['g']}✅ {r['id']:<14}{C['x']} {C['d']}{r['status']}  {r['location'] or ''}{C['x']}")
        else:
            tag = "(optional) " if r["optional"] else ""
            covered = "  <- fallback ready: " + ",".join(a for a in r["alt"] if by_id.get(a, {}).get("present")) if alt_ok(r, by_id) else ""
            mark = C['y'] if (r["optional"] or covered) else C['r']
            print(f"  {mark}❌ {r['id']:<14}{C['x']} {tag}{C['d']}{r['note'] or ''}{C['x']}{C['g']}{covered}{C['x']}")
            if not r["optional"] and not covered:
                miss.append(r["id"])

    if miss:
        print(f"\n{C['b']}Missing (fetch on demand when needed):{C['x']}")
        for m in miss:
            sp = TOOLS[m]
            if sp["kind"] == "runtime":
                print(f"  {m}: runtime, install manually -> {sp['url']}")
            else:
                print(f"  python tools/fetch.py {m}   {C['d']}# {sp['url']}{C['x']}")
    else:
        print(f"\n{C['g']}All required tools ready (or covered by a fallback).{C['x']}")
    print(f"\n{C['d']}Tip: no need to install everything at once; fetch tools as you use them. "
          f"IDA is a commercial option; if you have a license, GHIDRA or IDA (either one) is enough.{C['x']}")


if __name__ == "__main__":
    main()
