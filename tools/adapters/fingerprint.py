#!/usr/bin/env python3
"""
fingerprint.py — auto_reverse Phase 1 adapter: fingerprint an Android package.

Reads the APK only (zipfile, no extraction) and determines: ABI / framework (native, Flutter, RN, Unity) /
packer / custom native libraries (signature candidates) / dex size; package name and similar fields fall
back to apktool (optional). Emits a fingerprint.json with a unified schema for the brain's decision-tree routing.

Usage:
  python fingerprint.py <target.apk|.xapk|.apks> [-o out_dir] [--no-manifest]
Cross-platform (Windows/macOS/Linux), no third-party dependencies (apktool is an optional fallback).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

# ── Framework signatures: .so name -> framework ───────────────────────────────
FRAMEWORK_SO = {
    "libflutter.so": "flutter",
    "libapp.so": "flutter",
    "libhermes.so": "rn-hermes",
    "libjsc.so": "rn-jsc",
    "libil2cpp.so": "unity-il2cpp",
    "libunity.so": "unity-il2cpp",
    "libmonobdwgc-2.0.so": "unity-mono",
    "libmono.so": "unity-mono",
    "libcocos2djs.so": "cocos",
    "libcocos.so": "cocos",
    "libxamarin-app.so": "xamarin",
}

# ── Packer signatures: .so / filename fragment -> vendor ─────────────────────
PACKER_SIG = {
    "libjiagu": "360-jiagu",
    "libprotectclass": "360-jiagu",
    "libshell": "tencent-legu",
    "libshella": "tencent-legu",
    "libtup": "tencent-legu",
    "libtosprotection": "tencent-legu",
    "libtxshell": "tencent-legu",
    "libsecexe": "bangcle",
    "libsecmain": "bangcle",
    "libdexhelper": "bangcle",
    "libexec.so": "ijiami",
    "libexecmain": "ijiami",
    "ijiami": "ijiami",
    "libchaosvmp": "naga",
    "libddog": "naga",
    "libfdog": "naga",
    "libbaiduprotect": "baidu",
    "libmobisec": "ali-jaq",
    "libnesec": "netease-yidun",
    "libnsgpsdk": "netease-yidun",
    "libapp-protect": "generic-protect",
}

# Framework-bundled / common system .so files, excluded when identifying "custom signature libraries"
COMMON_SO = {
    "libc++_shared.so", "libc++.so", "libfb.so", "libfbjni.so",
    "libjsi.so", "libreactnativejni.so", "libreact*", "libglog.so",
}


def _entries(apk):
    with zipfile.ZipFile(apk) as z:
        return z.namelist(), {i.filename: i.file_size for i in z.infolist()}


def _abis(names):
    abis = set()
    for n in names:
        m = re.match(r"lib/([^/]+)/", n)
        if m:
            abis.add(m.group(1))
    return sorted(abis)


def _so_basenames(names):
    out = set()
    for n in names:
        if n.startswith("lib/") and n.endswith(".so"):
            out.add(os.path.basename(n).lower())
    return out


def detect_framework(so_names, names):
    ev = []
    fw = "native"
    for so in so_names:
        if so in FRAMEWORK_SO:
            fw = FRAMEWORK_SO[so]
            ev.append(so)
    # RN bundle corroborating evidence
    if any(n.endswith("index.android.bundle") for n in names) and fw == "native":
        fw = "rn-hermes"
        ev.append("assets/index.android.bundle")
    return fw, sorted(set(ev))


def detect_packer(so_names, names):
    ev, vendor = [], None
    blob = "\n".join(so_names) + "\n" + "\n".join(n.lower() for n in names)
    for sig, vend in PACKER_SIG.items():
        if sig in blob:
            vendor = vend
            ev.append(sig)
    return vendor, sorted(set(ev))


def dex_info(names, sizes):
    dexes = [n for n in names if re.match(r"classes\d*\.dex$", n)]
    total = sum(sizes.get(d, 0) for d in dexes)
    return {"count": len(dexes), "total_kb": round(total / 1024)}


def custom_native(so_names, framework_ev, packer_ev):
    skip = set(COMMON_SO) | {e.lower() for e in framework_ev} | {e.lower() for e in packer_ev}
    skip |= set(FRAMEWORK_SO.keys())
    out = []
    for so in sorted(so_names):
        if so in skip:
            continue
        if any(p in so for p in PACKER_SIG):
            continue
        out.append(so)
    return out


def read_manifest(apk):
    """Decode the manifest via the apktool fallback to get package name / debuggable flag / NSC. Returns empty on failure."""
    info = {"package": None, "debuggable": None, "network_security_config": False,
            "min_sdk": None, "target_sdk": None}
    apktool = shutil.which("apktool") or shutil.which("apktool.bat")
    if not apktool:
        return info, "apktool not on PATH, skipping manifest parsing"
    tmp = tempfile.mkdtemp(prefix="fp_")
    try:
        subprocess.run([apktool, "d", "-s", "-f", apk, "-o", os.path.join(tmp, "d")],
                       capture_output=True, timeout=180)
        mpath = os.path.join(tmp, "d", "AndroidManifest.xml")
        if os.path.exists(mpath):
            xml = open(mpath, encoding="utf-8", errors="replace").read()
            m = re.search(r'package="([^"]+)"', xml)
            info["package"] = m.group(1) if m else None
            info["debuggable"] = 'android:debuggable="true"' in xml
            info["network_security_config"] = "networkSecurityConfig" in xml
        ypath = os.path.join(tmp, "d", "apktool.yml")
        if os.path.exists(ypath):
            y = open(ypath, encoding="utf-8", errors="replace").read()
            mi = re.search(r"minSdkVersion:\s*'?(\d+)", y)
            ta = re.search(r"targetSdkVersion:\s*'?(\d+)", y)
            info["min_sdk"] = int(mi.group(1)) if mi else None
            info["target_sdk"] = int(ta.group(1)) if ta else None
        return info, None
    except Exception as e:
        return info, f"manifest parsing failed: {e}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="auto_reverse fingerprinting")
    ap.add_argument("apk")
    ap.add_argument("-o", "--out", default=None, help="output directory (defaults to the APK's directory)")
    ap.add_argument("--no-manifest", action="store_true", help="skip apktool manifest parsing (faster)")
    args = ap.parse_args()

    if not os.path.isfile(args.apk):
        print(f"file not found: {args.apk}", file=sys.stderr)
        sys.exit(1)

    names, sizes = _entries(args.apk)
    so_names = _so_basenames(names)
    framework, fw_ev = detect_framework(so_names, names)
    packer, pk_ev = detect_packer(so_names, names)
    natives = custom_native(so_names, fw_ev, pk_ev)
    dinfo = dex_info(names, sizes)

    manifest, mnote = ({}, "skipped") if args.no_manifest else read_manifest(args.apk)

    packed = bool(packer) or (dinfo["count"] >= 1 and dinfo["total_kb"] < 60 and not natives)

    protections = []
    if packer or packed:
        protections.append("packer")
    if manifest.get("network_security_config"):
        protections.append("ssl-pinning?(NSC)")
    # routing suggestion
    if packed:
        nxt = "unpack"
    elif framework in ("flutter", "rn-hermes", "rn-jsc", "unity-il2cpp", "unity-mono"):
        nxt = f"static({framework})"
    else:
        nxt = "static"

    oq = []
    if not natives and framework == "native" and not packed:
        oq.append("no custom native libraries — signing/encryption may be pure Java; in the static phase focus on OkHttp interceptors")
    if natives:
        oq.append(f"custom native libraries {natives}: signing/encryption candidates; locate boundaries statically, then move to the native phase")

    result = {
        "phase": "fingerprint",
        "status": "ok",
        "target": os.path.basename(args.apk),
        "abis": _abis(names),
        "framework": framework,
        "framework_evidence": fw_ev,
        "packed": packed,
        "packer": packer,
        "packer_evidence": pk_ev,
        "native_libs": natives,
        "dex": dinfo,
        "package": manifest.get("package"),
        "min_sdk": manifest.get("min_sdk"),
        "target_sdk": manifest.get("target_sdk"),
        "debuggable": manifest.get("debuggable"),
        "network_security_config": manifest.get("network_security_config", False),
        "protections": protections,
        "manifest_note": mnote,
        "open_questions": oq,
        "next_suggested": nxt,
    }

    out_dir = args.out or os.path.dirname(os.path.abspath(args.apk))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "fingerprint.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\n[fingerprint] → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
