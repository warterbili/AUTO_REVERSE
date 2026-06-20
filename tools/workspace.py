#!/usr/bin/env python3
"""
workspace.py — create the standard per-target workspace skeleton so phases never fail on
a missing directory.

  python tools/workspace.py init com.myprizepicks.myprizepicks
  python tools/workspace.py init https://example.com --type web

Creates workspace/<slug>/{00-intake .. 07-verify}/ and a stub 00-intake/meta.json that
conforms to brain/artifacts/meta.schema.json (fill in the timestamp/operator).
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHASES = ["00-intake", "01-fingerprint", "02-plan", "03-static",
          "04-dynamic", "05-native", "06-synthesize", "07-verify"]


def slug(target):
    s = re.sub(r"^https?://", "", target).strip("/")
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip("-").lower()
    return s or "target"


def infer_type(target):
    t = target.lower()
    if t.startswith(("http://", "https://")):
        return "web"
    if t.endswith((".apk", ".aab", ".xapk", ".apks")):
        return "android"
    if t.endswith((".ipa", ".app")):
        return "ios"
    if t.endswith((".exe", ".dll", ".sys")):
        return "windows"
    if t.endswith((".so", ".elf")):
        return "native"
    return "android"  # bare package id → android


def main():
    ap = argparse.ArgumentParser(description="initialise a target workspace")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init", help="create the phase-dir skeleton + stub meta.json")
    p.add_argument("target", help="package id / URL / file name")
    p.add_argument("--type", choices=["android", "ios", "web", "windows", "native"])
    p.add_argument("--operator", default="auto-reverse")
    args = ap.parse_args()

    s = slug(args.target)
    base = ROOT / "workspace" / s
    for ph in PHASES:
        (base / ph).mkdir(parents=True, exist_ok=True)

    meta_path = base / "00-intake" / "meta.json"
    if not meta_path.exists():
        meta = {
            "target": args.target,
            "type": args.type or infer_type(args.target),
            "timestamp": "<fill ISO-8601>",
            "operator": args.operator,
            "source": "<device|local|apkpure|url>",
            "files": [],
        }
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[workspace] ready: workspace/{s}/  ({len(PHASES)} phase dirs)")
    print(f"[workspace]   meta: workspace/{s}/00-intake/meta.json")


if __name__ == "__main__":
    main()
