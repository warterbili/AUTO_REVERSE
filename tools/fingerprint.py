#!/usr/bin/env python3
"""
fingerprint.py — Phase 1 helper. Scan an Android APK (+ splits) and emit a
fingerprint.json that conforms to brain/artifacts/fingerprint.schema.json.

  python tools/fingerprint.py base.apk split_config.arm64_v8a.apk
  python tools/fingerprint.py workspace/prizepicks/00-intake          # a dir of apks
  python tools/fingerprint.py app.apk -o workspace/app/01-fingerprint/fingerprint.json

Detects framework (Flutter / RN-Hermes / Unity / native Java), packers, RASP/anti-bot
SDKs, dex count, and checks catalog/targets.yaml to say whether the target is already
covered. Zero third-party deps for the scan (pyyaml only used for the coverage check).
"""
import argparse
import glob
import json
import os
import sys
import zipfile

# substring -> framework (checked against lib/<abi>/*.so names + asset names)
FRAMEWORK_LIBS = {
    "libflutter.so": "Flutter", "libapp.so": "Flutter",
    "libhermes.so": "React Native + Hermes", "libreactnative.so": "React Native",
    "libjsc.so": "React Native (JSC)", "libil2cpp.so": "Unity (IL2CPP)",
    "libunity.so": "Unity", "libmonosgen": "Unity (Mono)", "libxamarin": "Xamarin",
}
PACKER_LIBS = {
    "libjiagu": "360 Jiagu", "libshell": "generic shell", "libdexhelper": "Bangcle DexHelper",
    "libsecexe": "Bangcle", "libsecmain": "Bangcle", "libtup": "Tencent Legu",
    "libshella": "Tencent Legu", "libnesec": "NetEase", "libnqshield": "NQ Shield",
    "libbaiduprotect": "Baidu", "libtersafe": "Tencent", "libmobisec": "Ali Mobisec",
    "libprotectclass": "Ali", "libexec.so": "Ali", "libapssec": "ApkProtect",
    "libddog": "DexProtector", "libfdog": "DexProtector", "libkdp": "Kiwi",
}
# substring -> (sdk name, detail) for RASP / anti-bot / risk SDKs
PROTECTION_HINTS = {
    "libtampering-detection": ("tampering-detection (RASP)", "may detect repackaging/root/frida"),
    "libmsaoaidsec": ("msaoaidsec (anti-frida RASP)", "scans for frida; kills process"),
    "libtmxprofiling": ("ThreatMetrix", "device fingerprint / risk"),
    "libappshield": ("AppShield RASP", "runtime protection"),
}
# Keys must be specific enough to avoid false positives (e.g. NOT bare "castle" — that
# matches bouncycastle; NOT "shape" — that matches RN ARTShape). Prefer package paths.
ANTIBOT_HINTS = {
    "perimeterx": "PerimeterX", "px-cloud": "PerimeterX", "datadome": "DataDome",
    "io/castle/": "Castle.io", "akamai": "Akamai", "incapsula": "Imperva Incapsula",
    "kasada": "Kasada", "arkose": "Arkose", "funcaptcha": "Arkose FunCaptcha",
    "forter": "Forter", "siftscience": "Sift", "iovation": "iovation",
    "shapesecurity": "Shape Security", "appsflyer": "AppsFlyer (attribution/anti-fraud)",
}


def list_entries(apks):
    names = []
    for a in apks:
        try:
            with zipfile.ZipFile(a) as z:
                names += z.namelist()
        except Exception as e:
            print(f"[fingerprint] warning: cannot read {a}: {e}", file=sys.stderr)
    return names


def _hits(names, table):
    low = [n.lower() for n in names]
    found = {}
    for key, val in table.items():
        ev = next((n for n in low if key in n), None)
        if ev:
            found[val if isinstance(val, str) else val[0]] = (ev, val)
    return found


def coverage_check(target, names):
    """Match target name + entry hints against catalog/targets.yaml aliases."""
    try:
        import yaml
    except ImportError:
        return "skipped (pip install pyyaml to enable the catalog coverage check)"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tf = os.path.join(root, "catalog", "targets.yaml")
    if not os.path.exists(tf):
        return "skipped (catalog/targets.yaml not found)"
    doc = yaml.safe_load(open(tf, encoding="utf-8")) or {}
    hay = (target + " " + " ".join(names)).lower()
    for t in doc.get("targets", []):
        for alias in [t["name"]] + t.get("aliases", []):
            if str(alias).lower() in hay:
                return f"COVERED by '{t['id']}' (matched '{alias}') — route to its asset, do not re-reverse"
    return "uncovered — genuinely new target; add to catalog/targets.yaml when done"


def fingerprint(apks, target):
    names = list_entries(apks)
    libs = [n for n in names if n.startswith("lib/") and n.endswith(".so")]
    dex = sorted(n for n in names if n.split("/")[-1].startswith("classes") and n.endswith(".dex"))
    has_bundle = any(n.endswith("index.android.bundle") for n in names)

    fw_hits = _hits(libs, FRAMEWORK_LIBS)
    if "Flutter" in fw_hits:
        framework, chain = "Flutter", "Flutter chain (reFlutter/blutter); jadx is useless on the dart snapshot"
    elif "React Native + Hermes" in fw_hits or has_bundle:
        framework = "React Native + Hermes"
        chain = "RN-Hermes: decompile assets/index.android.bundle with hermes-dec/hermes-decomp → locate API signing in JS; frida-mitm to capture real requests"
    elif "React Native (JSC)" in fw_hits or "React Native" in fw_hits:
        framework, chain = "React Native (JSC)", "RN-JSC: the JS is in assets/index.android.bundle as plain/minified JS"
    elif any("Unity" in k for k in fw_hits):
        framework, chain = "Unity (IL2CPP)", "Unity: frida-il2cpp-bridge + Il2CppDumper on libil2cpp.so + global-metadata.dat"
    else:
        framework, chain = "Native Java/Kotlin", "Standard jadx chain → trace signing/crypto call sites → mark native boundary"

    packers = _hits(libs, PACKER_LIBS)
    packing = "none (real dex present)" if not packers else "; ".join(packers.keys())
    if len(dex) <= 1 and packers:
        packing += " — likely a stub (return to Phase 1 after android-unpacking)"

    protections = [{"name": name, "evidence": ev, "impact": meta[1]}
                   for name, (ev, meta) in _hits(libs, PROTECTION_HINTS).items()]
    antibot = [{"name": name, "evidence": ev}
               for name, (ev, _m) in _hits(names, ANTIBOT_HINTS).items()]

    open_q = []
    if framework.startswith("React Native"):
        open_q.append("HBC version of the Hermes bundle? (decides hermes-dec vs hermes-decomp)")
    if protections:
        open_q.append("Do the RASP libs block frida/repackaging at runtime? (needs a dynamic test)")
    open_q.append("Is there a request-signing header/param on the API? (needs dynamic capture)")

    return {
        "phase": "fingerprint",
        "status": "ok",
        "target": target,
        "acquired": [os.path.basename(a) for a in apks],
        "app_framework": framework,
        "evidence_framework": [meta[0] for meta in fw_hits.values()] + (["assets/index.android.bundle"] if has_bundle else []),
        "packing": packing,
        "dex_count": len(dex),
        "protections": protections,
        "antibot_fingerprint_sdks": antibot,
        "coverage_check": coverage_check(target, names),
        "next_chain": chain,
        "open_questions": open_q,
    }


def main():
    ap = argparse.ArgumentParser(description="Phase 1 fingerprint helper")
    ap.add_argument("paths", nargs="+", help="apk file(s) or a directory of apks")
    ap.add_argument("-o", "--out", help="write fingerprint.json here (default: stdout)")
    ap.add_argument("--target", help="target id (default: inferred from the first apk name)")
    args = ap.parse_args()

    apks = []
    for p in args.paths:
        if os.path.isdir(p):
            apks += sorted(glob.glob(os.path.join(p, "*.apk")))
        else:
            apks.append(p)
    if not apks:
        print("[fingerprint] no .apk found", file=sys.stderr)
        sys.exit(1)

    target = args.target or os.path.splitext(os.path.basename(apks[0]))[0]
    result = fingerprint(apks, target)
    out = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(out + "\n")
        print(f"[fingerprint] wrote {args.out}  ({result['app_framework']}, {result['dex_count']} dex)")
    else:
        print(out)


if __name__ == "__main__":
    main()
