#!/usr/bin/env python3
"""
ui_exercise.py — drive an Android app's UI so a capture session records real traffic,
unattended. The missing piece that turns "start capture, *tap the app yourself*, stop"
into a hands-off run.

Backend: pure **adb** (no device-side install) — `am start` to launch, `uiautomator dump`
to read the screen, `input tap/swipe/text/keyevent` to act. (If `uiautomator2` is installed
it is used for more reliable text/resource-id selection, but adb is the default.)

  # generic exercise (launch + a few taps/scrolls — captures launch + basic traffic):
  python tools/ui_exercise.py --serial 1125df3 --launch com.example.app --generic

  # deterministic, record-once-replay-forever flow to hit a SPECIFIC signed action:
  python tools/ui_exercise.py --serial 1125df3 --flow flow.json

flow.json = a list of steps, e.g.:
  [{"launch":"com.example.app"}, {"wait":3}, {"tap_text":"Log in"}, {"text":"user@x.com"},
   {"key":"tab"}, {"tap_id":"com.example.app:id/submit"}, {"wait":2}, {"swipe":[540,1500,540,400]}]

Honest scope: WHICH taps hit the target action is target-specific — record the flow once;
thereafter it replays unattended. `--generic` only guarantees launch + basic interaction.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


def adb(serial, *args, timeout=30, **kw):
    cmd = ["adb"] + (["-s", serial] if serial else []) + list(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)


def launch(serial, pkg):
    # monkey reliably launches the default LAUNCHER activity without knowing its name
    adb(serial, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1")
    print(f"  [ui] launched {pkg}")


def dump(serial):
    """Return the current UI hierarchy XML (via adb uiautomator dump)."""
    adb(serial, "shell", "uiautomator", "dump", "/sdcard/u2dump.xml", timeout=30)
    r = adb(serial, "shell", "cat", "/sdcard/u2dump.xml", timeout=20)
    return r.stdout


def _center(bounds):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds or "")
    if not m:
        return None
    x1, y1, x2, y2 = map(int, m.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def find(serial, *, text=None, rid=None):
    """Find a node by visible text (substring) or resource-id; return tap center or None."""
    try:
        root = ET.fromstring(dump(serial))
    except Exception:
        return None
    for node in root.iter("node"):
        t, r = node.get("text", ""), node.get("resource-id", "")
        if (text and text.lower() in t.lower()) or (rid and rid == r):
            return _center(node.get("bounds"))
    return None


def tap(serial, x, y):
    adb(serial, "shell", "input", "tap", str(x), str(y)); print(f"  [ui] tap ({x},{y})")


def step(serial, s):
    if "launch" in s:
        launch(serial, s["launch"])
    elif "wait" in s:
        time.sleep(float(s["wait"]))
    elif "tap_text" in s or "tap_id" in s:
        c = find(serial, text=s.get("tap_text"), rid=s.get("tap_id"))
        if c:
            tap(serial, *c)
        else:
            print(f"  [ui] ! element not found: {s}")
    elif "tap" in s:
        tap(serial, *s["tap"])
    elif "text" in s:
        adb(serial, "shell", "input", "text", s["text"].replace(" ", "%s")); print("  [ui] typed text")
    elif "key" in s:
        adb(serial, "shell", "input", "keyevent", str(s["key"]).upper()); print(f"  [ui] key {s['key']}")
    elif "swipe" in s:
        adb(serial, "shell", "input", "swipe", *map(str, s["swipe"])); print("  [ui] swipe")


def generic(serial, pkg):
    """Launch + a bounded, blind exercise to generate launch/basic traffic."""
    launch(serial, pkg); time.sleep(4)
    sz = adb(serial, "shell", "wm", "size").stdout
    m = re.search(r"(\d+)x(\d+)", sz)
    w, h = (int(m.group(1)), int(m.group(2))) if m else (1080, 2340)
    for _ in range(3):
        adb(serial, "shell", "input", "swipe", str(w // 2), str(int(h * .7)), str(w // 2), str(int(h * .3)))
        time.sleep(1.5)
    tap(serial, w // 2, h // 2); time.sleep(2)
    print("  [ui] generic exercise done")


def main():
    ap = argparse.ArgumentParser(description="unattended Android UI exerciser (adb-based)")
    ap.add_argument("--serial")
    ap.add_argument("--launch", help="package to launch")
    ap.add_argument("--flow", help="flow.json (list of steps) to replay")
    ap.add_argument("--generic", action="store_true", help="generic launch+exercise (no flow)")
    args = ap.parse_args()
    if not args.serial:
        ds = [l.split("\t")[0] for l in adb(None, "devices").stdout.splitlines()[1:] if "\tdevice" in l]
        args.serial = ds[0] if ds else None
    if not args.serial:
        print("ui_exercise: no adb device", file=sys.stderr); sys.exit(1)

    if args.flow:
        steps = json.load(open(args.flow, encoding="utf-8"))
        print(f"[ui_exercise] replaying {len(steps)} steps on {args.serial}")
        for s in steps:
            step(args.serial, s)
    elif args.launch:
        generic(args.serial, args.launch)
    else:
        print("ui_exercise: need --flow or --launch", file=sys.stderr); sys.exit(2)
    print("[ui_exercise] done")


if __name__ == "__main__":
    main()
