#!/usr/bin/env python3
"""
hermes_strings.py — dump the string table of a Hermes (React Native) bundle cleanly.

Plain `strings` is useless on a Hermes bundle: the string table is stored back-to-back
with no separators, so you get giant concatenated blobs. This parses the real string
table (via hermes-dec) and prints one string per line — so grep actually works.

  python tools/hermes_strings.py index.android.bundle
  python tools/hermes_strings.py base.apk --grep 'hmac|signature|api\\.'
  python tools/hermes_strings.py base.apk -o 03-static/strings.txt

Needs hermes-dec (python tools/fetch.py hermes-dec). If run with a Python that lacks it,
this script re-execs itself with the project venv automatically.
"""
import argparse
import io
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _ensure_hermes_runtime():
    try:
        import hermes_dec  # noqa: F401
        return
    except ImportError:
        pass
    venv_py = ROOT / ".venv" / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
    here = os.path.abspath(sys.executable)
    if venv_py.exists() and here != os.path.abspath(str(venv_py)):
        sys.exit(subprocess.run([str(venv_py), os.path.abspath(__file__), *sys.argv[1:]]).returncode)
    # in the venv (or none yet) and still missing → auto-fetch hermes-dec into the project, then retry
    print("[hermes_strings] hermes-dec missing → fetching into the project .venv …", file=sys.stderr)
    subprocess.run([sys.executable, str(ROOT / "tools" / "fetch.py"), "hermes-dec"])
    if venv_py.exists() and here != os.path.abspath(str(venv_py)):
        sys.exit(subprocess.run([str(venv_py), os.path.abspath(__file__), *sys.argv[1:]]).returncode)
    try:
        import hermes_dec  # noqa: F401
        return
    except ImportError:
        print("[hermes_strings] hermes-dec unavailable after auto-fetch", file=sys.stderr)
        sys.exit(1)


def read_bundle_bytes(path):
    """Return the Hermes bytecode bytes, extracting from an APK if needed."""
    if path.lower().endswith(".apk"):
        with zipfile.ZipFile(path) as z:
            name = next((n for n in z.namelist() if n.endswith("index.android.bundle")), None)
            if not name:
                print(f"[hermes_strings] no index.android.bundle inside {path}", file=sys.stderr)
                sys.exit(1)
            return z.read(name)
    return Path(path).read_bytes()


def dump_strings(data):
    from hermes_dec.parsers.hbc_file_parser import HBCReader
    r = HBCReader()
    r.read_whole_file(io.BytesIO(data))
    return list(r.strings)


def main():
    ap = argparse.ArgumentParser(description="dump a Hermes bundle's string table, one per line")
    ap.add_argument("path", help="index.android.bundle or an .apk containing it")
    ap.add_argument("--grep", help="only print strings matching this regex (case-insensitive)")
    ap.add_argument("-o", "--out", help="write to a file instead of stdout")
    ap.add_argument("--unique", action="store_true", help="dedupe and sort")
    args = ap.parse_args()

    _ensure_hermes_runtime()
    strings = dump_strings(read_bundle_bytes(args.path))

    if args.grep:
        rx = re.compile(args.grep, re.IGNORECASE)
        strings = [s for s in strings if rx.search(s)]
    if args.unique:
        strings = sorted(set(strings))

    body = "\n".join(strings)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body + "\n")
        print(f"[hermes_strings] wrote {len(strings)} strings -> {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(body + "\n")


if __name__ == "__main__":
    main()
