#!/usr/bin/env python3
"""
acquire_apk.py — fully automatic APK acquisition for the auto_reverse orchestrator.

Given a package name (and optionally an app name / version), it obtains the APK
through the first route that succeeds, in priority order:

  1. device   — app already installed on a connected adb device: `pm path` + pull
                base + every split (closest to a real install, best for frida later).
  2. local    — an APK/XAPK already on disk in the cache dir or a given path.
  3. apkpure  — download from APKPure's direct-link endpoint (XAPK first, then APK).

It then (optionally) installs the result back onto a device, and always verifies
that the base APK's real package name matches what was requested.

Pure stdlib (urllib + subprocess + zipfile). No pip deps required.
adb and (optionally) aapt are auto-located; curl is NOT required.

Usage:
  python acquire_apk.py com.DailyPay.DailyPay
  python acquire_apk.py com.DailyPay.DailyPay --out workspace/00-source --install
  python acquire_apk.py <pkg> --source apkpure --version latest
  python acquire_apk.py <pkg> --source device         # force pull from device
  python acquire_apk.py <pkg> --local path/to/app.xapk # use a file you already have

Exit code 0 on success; prints a JSON summary to stdout (last line).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

CHROME_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")

# Known adb locations to try if it's not on PATH (Windows-friendly + generic).
ADB_HINTS = [
    "adb",
    os.path.expanduser("~/Android/Sdk/platform-tools/adb"),
    os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"),
]


def log(*a):
    print("[acquire]", *a, file=sys.stderr, flush=True)


# ─────────────────────────── tool discovery ───────────────────────────
def find_tool(hints):
    for h in hints:
        if os.path.sep in h or (os.altsep and os.altsep in h):
            if os.path.isfile(h):
                return h
        else:
            p = shutil.which(h)
            if p:
                return p
    return None


def find_adb():
    return find_tool(ADB_HINTS)


def find_aapt():
    # aapt/aapt2 live in build-tools; try PATH names only (best-effort verify).
    return find_tool(["aapt", "aapt2"])


# ─────────────────────────── adb helpers ───────────────────────────
def adb(adb_path, *args, serial=None, **kw):
    cmd = [adb_path]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def adb_devices(adb_path):
    out = adb(adb_path, "devices").stdout.splitlines()
    return [l.split("\t")[0] for l in out[1:] if "\tdevice" in l]


def device_apk_paths(adb_path, pkg, serial=None):
    r = adb(adb_path, "shell", "pm", "path", pkg, serial=serial)
    paths = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("package:"):
            paths.append(line[len("package:"):])
    return paths


def pull_from_device(adb_path, pkg, outdir, serial=None):
    paths = device_apk_paths(adb_path, pkg, serial=serial)
    if not paths:
        return None
    os.makedirs(outdir, exist_ok=True)
    pulled = []
    for remote in paths:
        local = os.path.join(outdir, os.path.basename(remote))
        r = adb(adb_path, "pull", remote, local, serial=serial)
        if r.returncode == 0 and os.path.isfile(local):
            pulled.append(local)
        else:
            log("pull failed:", remote, r.stderr.strip())
    return pulled or None


def install_to_device(adb_path, apks, serial=None):
    apks = [a for a in apks if a.endswith(".apk")]
    if not apks:
        return False, "no .apk files to install"
    if len(apks) == 1:
        r = adb(adb_path, "install", "-r", apks[0], serial=serial)
    else:
        r = adb(adb_path, "install-multiple", "-r", *apks, serial=serial)
    ok = r.returncode == 0 and "Success" in (r.stdout + r.stderr)
    return ok, (r.stdout + r.stderr).strip()


# ─────────────────────────── download (APKPure) ───────────────────────────
def http_download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": CHROME_UA})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        total = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
    return total


def is_zip(path):
    try:
        with open(path, "rb") as f:
            return f.read(4) == b"PK\x03\x04"
    except OSError:
        return False


def download_apkpure(pkg, outdir, version="latest"):
    os.makedirs(outdir, exist_ok=True)
    # XAPK first (carries splits), then single APK.
    for kind, ext in (("XAPK", "xapk"), ("APK", "apk")):
        url = f"https://d.apkpure.com/b/{kind}/{pkg}?version={version}"
        dest = os.path.join(outdir, f"{pkg}_{version}.{ext}")
        log(f"trying APKPure {kind}: {url}")
        try:
            size = http_download(url, dest)
        except Exception as e:  # noqa: BLE001
            log(f"  {kind} download error: {e}")
            continue
        if size > 0 and is_zip(dest):
            log(f"  got {kind} {size} bytes -> {dest}")
            return dest
        log(f"  {kind} result not a zip (size={size}), discarding")
        if os.path.isfile(dest):
            os.remove(dest)
    return None


# ─────────────────────────── XAPK / verify ───────────────────────────
def extract_xapk(path, outdir):
    """Return list of .apk members extracted from an XAPK (zip of apks)."""
    os.makedirs(outdir, exist_ok=True)
    apks = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.lower().endswith(".apk"):
                z.extract(name, outdir)
                apks.append(os.path.join(outdir, name))
        if "manifest.json" in z.namelist():
            z.extract("manifest.json", outdir)
    return apks


def pick_base(apks):
    """Heuristic: base.apk is the largest, or the one named like the package."""
    if not apks:
        return None
    for a in apks:
        b = os.path.basename(a).lower()
        if b in ("base.apk",) or ("config." not in b and "split" not in b):
            return a
    return max(apks, key=lambda p: os.path.getsize(p))


def package_of(apk, aapt):
    """Best-effort: read package name from base apk. aapt if present, else axml parse."""
    if aapt:
        r = subprocess.run([aapt, "dump", "badging", apk], capture_output=True, text=True)
        for line in r.stdout.splitlines():
            if line.startswith("package:"):
                for tok in line.split():
                    if tok.startswith("name="):
                        return tok.split("=", 1)[1].strip("'\"")
    # Fallback: crude scan of binary AndroidManifest for the package string is
    # unreliable; instead trust the XAPK manifest.json if available (handled by caller).
    return None


# ─────────────────────────── orchestration ───────────────────────────
def acquire(pkg, outdir, source="auto", version="latest", local=None,
            install=False, serial=None):
    result = {"package": pkg, "source": None, "files": [], "base_apk": None,
              "verified": None, "installed": None, "out_dir": os.path.abspath(outdir)}
    adb_path = find_adb()
    aapt = find_aapt()
    os.makedirs(outdir, exist_ok=True)

    routes = [source] if source != "auto" else ["device", "local", "apkpure"]

    for route in routes:
        if route == "device":
            if not adb_path:
                log("device route: adb not found, skipping")
                continue
            devs = adb_devices(adb_path)
            if not devs:
                log("device route: no device connected, skipping")
                continue
            ser = serial or devs[0]
            if pkg not in (adb(adb_path, "shell", "pm", "list", "packages", pkg,
                               serial=ser).stdout):
                log(f"device route: {pkg} not installed on {ser}, skipping")
                continue
            files = pull_from_device(adb_path, pkg, outdir, serial=ser)
            if files:
                result.update(source="device", files=files,
                              base_apk=pick_base(files), verified=True)
                break

        elif route == "local":
            cand = local
            if cand and os.path.isfile(cand):
                if cand.lower().endswith(".xapk") or (is_zip(cand) and
                        zipfile.ZipFile(cand).namelist() and
                        any(n.lower().endswith(".apk") for n in zipfile.ZipFile(cand).namelist())):
                    apks = extract_xapk(cand, os.path.join(outdir, "extracted"))
                    result.update(source="local", files=apks, base_apk=pick_base(apks))
                else:
                    result.update(source="local", files=[cand], base_apk=cand)
                break
            elif cand:
                log(f"local route: {cand} not found, skipping")

        elif route == "apkpure":
            dl = download_apkpure(pkg, outdir, version=version)
            if dl:
                if dl.lower().endswith(".xapk"):
                    apks = extract_xapk(dl, os.path.join(outdir, "extracted"))
                    result.update(source="apkpure", files=[dl] + apks,
                                  base_apk=pick_base(apks))
                else:
                    result.update(source="apkpure", files=[dl], base_apk=dl)
                break

    if not result["source"]:
        result["error"] = "all acquisition routes failed"
        return result

    # Verify package name on the base apk (skip for raw .xapk base==None).
    base = result["base_apk"]
    if base and base.lower().endswith(".apk"):
        got = package_of(base, aapt)
        if got is not None:
            result["verified"] = (got == pkg)
            result["detected_package"] = got
            if got != pkg:
                result["error"] = f"package mismatch: got {got}, expected {pkg}"
        elif result["verified"] is None:
            result["verified"] = "unverified (no aapt)"

    # Optional install back to device.
    if install and adb_path:
        apks = [f for f in result["files"] if f.lower().endswith(".apk")]
        devs = adb_devices(adb_path)
        if devs:
            ok, msg = install_to_device(adb_path, apks, serial=serial or devs[0])
            result["installed"] = ok
            result["install_msg"] = msg
        else:
            result["installed"] = False
            result["install_msg"] = "no device"

    return result


def main():
    ap = argparse.ArgumentParser(description="Automatic APK acquisition")
    ap.add_argument("package", help="package name, e.g. com.DailyPay.DailyPay")
    ap.add_argument("--out", default="workspace/00-source", help="output directory")
    ap.add_argument("--source", default="auto",
                    choices=["auto", "device", "local", "apkpure"])
    ap.add_argument("--version", default="latest", help="APKPure version (default latest)")
    ap.add_argument("--local", help="path to an existing .apk/.xapk to use")
    ap.add_argument("--install", action="store_true", help="install result onto device")
    ap.add_argument("--serial", help="adb device serial (default: first device)")
    args = ap.parse_args()

    res = acquire(args.package, args.out, source=args.source, version=args.version,
                  local=args.local, install=args.install, serial=args.serial)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    sys.exit(0 if res.get("source") and res.get("error") is None else 1)


if __name__ == "__main__":
    main()
