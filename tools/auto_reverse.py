#!/usr/bin/env python3
"""
auto_reverse.py — headless, from-zero autonomous reversing driver.

One command takes a bare target and drives the brain's pipeline over the CLI helpers
that work headlessly (no GUI), writing phase artifacts into workspace/<slug>/ plus a
machine-readable status.json and a human-readable report.md. Resumable: re-running
skips phases whose artifacts already exist (use --force to redo).

  python tools/auto_reverse.py app.apk
  python tools/auto_reverse.py com.example.app --device 1125df3
  python tools/auto_reverse.py https://example.com --type web
  python tools/auto_reverse.py app.apk --workspace-root tmp/smoke-workspaces

Design: this automates the *verifiable, headless* spine (intake -> fingerprint -> plan
-> static, plus native decompile when Ghidra is available). Phases that genuinely need a
device, a GUI, or human judgement are not faked — they are emitted as explicit
NEXT ACTIONS in status.json/report.md with the exact command to run. An agent reads
status.json to know precisely what is done, blocked, or awaiting it.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile

# ── native .so auto-targeting heuristics ──
SO_NAME_SIGNAL = re.compile(r"(?i)tamper|detect|secur|protect|guard|shield|sign|crypt|ssl|"
                            r"jiagu|msaoaidsec|aoaidsec|root|frida|rasp|verif|legu|bangcle|nesec|xpoint")
SO_NOISE = re.compile(r"(?i)c\+\+_shared|reactnative|hermes|flutter|fbjni|^libjsi|reanimated|folly|"
                      r"fabric|glog|libjsc|il2cpp|libunity|libmono|sqlite|libpng|libjpeg|webp|avif|"
                      r"libgif|skia|pdfium|opencv|tensorflow|sentry|datastore|graphic|imagepipeline|"
                      r"gesture|screens|svg|mmkv|worklets|rive|animation|codegen|barhopper|filter")
STR_SIGNALS = [b"frida", b"ptrace", b"/proc/self/maps", b"/proc/self/status", b"TracerPid",
               b"gum-js", b"magisk", b"/data/local/tmp", b"JNI_OnLoad", b"RegisterNatives",
               b"dlsym", b"AES", b"HMAC", b"RSA", b"sign", b"secret", b"encrypt", b"which su"]

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PY = sys.executable
WS = os.path.join(ROOT, "workspace")


def sh(cmd, timeout=900, cwd=None):
    """Run a command, return (rc, stdout, stderr). Never raises."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return p.returncode, p.stdout, p.stderr
    except Exception as e:  # noqa: BLE001
        return 1, "", str(e)


def slug(target):
    import re
    s = re.sub(r"^https?://", "", target).strip("/")
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip("-").lower()
    return (s or "target")[:80]


def target_slug(target):
    return slug(os.path.basename(target) if os.path.isfile(target) else target)


def infer_type(t):
    t = t.lower()
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
    return "android"  # bare package id


def covered_target_id(coverage):
    m = re.search(r"COVERED by '([^']+)'", coverage or "")
    return m.group(1) if m else None


def load_target_route(target_id):
    try:
        import yaml
        doc = yaml.safe_load(open(os.path.join(ROOT, "catalog", "targets.yaml"), encoding="utf-8")) or {}
    except Exception:
        return None
    for item in doc.get("targets", []):
        if item.get("id") != target_id:
            continue
        assets = item.get("assets", [])
        skill = next((a for a in assets if a.get("kind") == "skill"), None)
        pointer = next((a for a in assets if a.get("kind") == "pointer"), None)
        primary = skill or pointer or (assets[0] if assets else {})
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "domain": item.get("domain"),
            "status": item.get("status"),
            "asset_kind": primary.get("kind"),
            "asset_ref": primary.get("ref"),
            "asset_path": primary.get("path"),
            "asset_url": primary.get("url"),
            "summary": item.get("summary"),
        }
    return None


def match_target_route(text):
    try:
        import yaml
        doc = yaml.safe_load(open(os.path.join(ROOT, "catalog", "targets.yaml"), encoding="utf-8")) or {}
    except Exception:
        return None
    hay = (text or "").lower()
    for item in doc.get("targets", []):
        aliases = [item.get("name", "")] + item.get("aliases", [])
        if any(str(alias).lower() in hay for alias in aliases if alias):
            return load_target_route(item.get("id"))
    return None


ANTIBOT_ROUTES = [
    ("Castle", "castle-reverse"),
    ("PerimeterX", "px-reverse"),
    ("Akamai", "akamai-reverse"),
    ("DataDome", "datadome-generator"),
]


def _resolve(tool_id):
    """(status, location) via the project's resolver: venv -> tools/bin -> PATH."""
    try:
        sys.path.insert(0, HERE)
        from _toolspec import resolve
        return resolve(tool_id)
    except Exception:
        loc = shutil.which(tool_id) or shutil.which(tool_id + ".bat")
        return ("present-path", loc) if loc else ("missing", None)


def ensure_tool(tool_id):
    """Resolve a tool from the project (venv/tools/bin/PATH); if missing, auto-fetch it
    INTO the project (tools/bin or .venv) via fetch.py, then re-resolve. Returns path or None."""
    st, loc = _resolve(tool_id)
    if st and st.startswith("present"):
        return loc
    print(f"  [provision] '{tool_id}' not found → fetching into the project (tools/bin or .venv)…")
    sh([PY, os.path.join(HERE, "fetch.py"), tool_id], timeout=1800)
    st, loc = _resolve(tool_id)
    return loc if st and st.startswith("present") else None


def resolve_ghidra_headless():
    name = "analyzeHeadless.bat" if os.name == "nt" else "analyzeHeadless"
    import glob
    for env in ("GHIDRA_INSTALL_DIR", "GHIDRA_HOME"):
        d = os.environ.get(env)
        if d and os.path.exists(os.path.join(d, "support", name)):
            return os.path.join(d, "support", name)
    # project tools/bin (where fetch.py lands a downloaded ghidra)
    for g in glob.glob(os.path.join(ROOT, "tools", "bin", "ghidra*", "**", "support", name), recursive=True):
        return g
    # derive from the project resolver's ghidra location (ghidraRun.bat → ../support/)
    _st, loc = _resolve("ghidra")
    if loc:
        base = os.path.dirname(loc) if loc.lower().endswith(("ghidrarun.bat", "ghidrarun")) else loc
        cand = os.path.join(base, "support", name)
        if os.path.exists(cand):
            return cand
    for cand in (shutil.which("analyzeHeadless"), shutil.which("analyzeHeadless.bat")):
        if cand:
            return cand
    for g in glob.glob(os.path.join(os.path.expanduser("~"), "**", "support", name), recursive=True):
        if "ghidra" in g.lower():
            return g
    return None


class Run:
    def __init__(self, target, ttype, device, force, auto_capture=False, flow=None,
                 workspace_root=None):
        self.target, self.device, self.force = target, device, force
        self.auto_capture, self.flow = auto_capture, flow
        self.type = ttype or infer_type(target)
        self.slug = target_slug(target)
        self.workspace_root = os.path.abspath(workspace_root or WS)
        self.base = os.path.join(self.workspace_root, self.slug)
        self.phases = []      # status records
        self.actions = []     # NEXT ACTIONS (needs device/human/tool)

    # ---- helpers ----
    def d(self, *p):
        return os.path.join(self.base, *p)

    def have(self, rel):
        return os.path.exists(self.d(rel)) and not self.force

    def display_base(self):
        try:
            path = os.path.relpath(self.base, ROOT)
        except ValueError:
            path = self.base
        return path.replace(os.sep, "/")

    def record(self, phase, status, notes, artifact=None):
        self.phases.append({"phase": phase, "status": status, "notes": notes, "artifact": artifact})
        print(f"  [{status:^11}] {phase}: {notes}")

    def need(self, what, why, command):
        self.actions.append({"need": what, "why": why, "command": command})

    def _first_intake_apk(self):
        intake = self.d("00-intake")
        if not os.path.isdir(intake):
            return None
        apks = [self.d("00-intake", f) for f in os.listdir(intake) if f.endswith(".apk")]
        return next((a for a in apks if os.path.basename(a) == "base.apk"), None) or (apks[0] if apks else None)

    # ---- phases ----
    def init(self):
        sh([PY, os.path.join(HERE, "workspace.py"), "init", self.target,
            "--type", self.type, "--root", self.workspace_root])

    def intake(self):
        if self.have("00-intake/meta.json") and any(
                f.endswith((".apk", ".so", ".ipa", ".exe")) for f in os.listdir(self.d("00-intake"))):
            self.record("0-intake", "cached", "target already in 00-intake/")
            return
        dst = self.d("00-intake")
        os.makedirs(dst, exist_ok=True)
        if os.path.isfile(self.target):
            shutil.copy2(self.target, dst)
            self.record("0-intake", "ok", f"copied {os.path.basename(self.target)}")
        elif self.type == "android":
            acq = os.path.join(ROOT, "skills", "android", "apk-acquire", "scripts", "acquire_apk.py")
            cmd = [PY, acq, self.target, "--out", dst]
            if self.device:
                cmd += ["--serial", self.device, "--source", "device"]
            rc, out, err = sh(cmd, timeout=600)
            if rc == 0 and any(f.endswith(".apk") for f in os.listdir(dst)):
                self.record("0-intake", "ok", f"acquired {self.target}")
            else:
                self.record("0-intake", "needs_device", f"could not auto-acquire {self.target}")
                self.need("device/target", "no APK on disk and acquisition failed",
                          f"python {acq} {self.target} --out {dst} --serial <adb-serial>")
        elif self.type == "web":
            self.record("0-intake", "ok", f"web target {self.target} (no file to acquire)")
        else:
            self.record("0-intake", "needs_human", f"provide the {self.type} target file in {dst}")

    def fingerprint(self):
        out = self.d("01-fingerprint", "fingerprint.json")
        if self.have("01-fingerprint/fingerprint.json"):
            self.record("1-fingerprint", "cached", "fingerprint.json present")
            return
        if self.type != "android":
            self.record("1-fingerprint", "needs_human",
                        f"no headless fingerprinter for '{self.type}' yet; inspect manually")
            self.need("fingerprint", f"{self.type} fingerprinting not automated",
                      "see brain/SKILL.md Phase 1 (web: cdp-browser; ios/windows: detect-it-easy)")
            return
        apks = [self.d("00-intake", f) for f in os.listdir(self.d("00-intake"))] if os.path.isdir(self.d("00-intake")) else []
        apks = [a for a in apks if a.endswith(".apk")]
        if not apks:
            self.record("1-fingerprint", "blocked", "no apk in 00-intake/")
            return
        rc, o, e = sh([PY, os.path.join(HERE, "fingerprint.py"), self.d("00-intake"),
                       "-o", out, "--target", self.target])
        self.record("1-fingerprint", "ok" if rc == 0 else "blocked", o.strip() or e.strip()[:120], out)

    def _fp(self):
        try:
            return json.load(open(self.d("01-fingerprint", "fingerprint.json"), encoding="utf-8"))
        except Exception:
            return {}

    def plan(self):
        out = self.d("02-plan", "plan.json")
        if self.have("02-plan/plan.json"):
            self.record("2-plan", "cached", "plan.json present"); return
        fp = self._fp()
        covered = load_target_route(covered_target_id(fp.get("coverage_check"))) or match_target_route(self.target)
        if covered:
            asset = covered.get("asset_ref") or covered.get("asset_path") or covered.get("asset_url") or covered["id"]
            plan = {"phase": "plan", "playbook": asset, "covered_target": covered, "tasks": [
                {"question": f"Target is already covered: {covered.get('name') or covered['id']}",
                 "use": asset, "expect": "route to the existing asset; do not re-reverse from scratch"},
                {"question": "Verify the existing asset still applies to this exact version/session",
                 "use": "asset-specific verify path + oracle when a replay request is synthesized",
                 "expect": "verified report with desensitized evidence"},
            ]}
            os.makedirs(self.d("02-plan"), exist_ok=True)
            json.dump(plan, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
            self.record("2-plan", "ok", f"covered target -> {asset}", out)
            return

        antibot_names = [str(x.get("name", "")) for x in fp.get("antibot_fingerprint_sdks", []) if isinstance(x, dict)]
        sdk_route = next((skill for needle, skill in ANTIBOT_ROUTES
                          if any(needle.lower() in name.lower() for name in antibot_names)), None)
        if sdk_route:
            plan = {"phase": "plan", "playbook": sdk_route, "tasks": [
                {"question": f"Dedicated anti-bot SDK detected ({', '.join(antibot_names)})",
                 "use": sdk_route, "expect": "SDK-specific static/dynamic workflow"},
                {"question": "Capture real request shape and token fields",
                 "use": "frida-mitm-capture", "expect": "04-dynamic findings (needs device)"},
                {"question": "Replay the reproduced token/request",
                 "use": "oracle.py", "expect": "07-verify result"},
            ]}
            os.makedirs(self.d("02-plan"), exist_ok=True)
            json.dump(plan, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
            self.record("2-plan", "ok", f"anti-bot SDK -> {sdk_route}", out)
            return

        fw = (fp.get("app_framework") or "").lower()
        if "hermes" in fw:
            pb, t1 = "android-rn-hermes", {"question": "Where is API signing in the Hermes bundle?",
                                          "use": "hermes_strings.py + hermes-dec", "expect": "03-static findings"}
        elif "flutter" in fw:
            pb, t1 = "android-flutter", {"question": "reFlutter/blutter the dart snapshot", "use": "reflutter", "expect": "endpoints"}
        elif "unity" in fw:
            pb, t1 = "android-unity", {"question": "dump il2cpp", "use": "Il2CppDumper/frida-il2cpp-bridge", "expect": "metadata"}
        elif self.type == "web":
            pb, t1 = "web-antibot", {"question": "which requests carry signatures?", "use": "cdp-browser + web-api-analyzer", "expect": "signed request or endpoint inventory"}
        else:
            pb, t1 = "android-java-sign", {"question": "locate signing/crypto call sites", "use": "jadx", "expect": "native boundary"}
        plan = {"phase": "plan", "playbook": pb, "tasks": [
            t1,
            {"question": "real request shape (headers/params)?", "use": "frida-mitm-capture", "expect": "04-dynamic findings (needs device)"},
            {"question": "if signing is native, extract it", "use": "ghidra (headless) / unidbg", "expect": "05-native findings"},
        ]}
        os.makedirs(self.d("02-plan"), exist_ok=True)
        json.dump(plan, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        self.record("2-plan", "ok", f"playbook={pb}", out)

    def unpack(self):
        """If the fingerprint found a packer, dump the released DEX from memory (frida-dexdump)."""
        fp = self._fp()
        packing = (fp.get("packing") or "").lower()
        if not packing or "none" in packing:
            self.record("1b-unpack", "skipped", "not packed (real dex present)"); return
        outdir = self.d("unpacked")
        if os.path.isdir(outdir) and any(f.endswith(".dex") for f in os.listdir(outdir)) and not self.force:
            self.record("1b-unpack", "cached", "unpacked dex already present"); return
        pkg, serial = self._pkg(), self._adb_device()
        if not serial or pkg == "<package>":
            self.record("1b-unpack", "needs_device",
                        f"packed ({packing.split(';')[0]}) — needs a device with the app installed to dump DEX from memory")
            self.need("unpack", "run the app on a device and dump the real DEX the packer releases",
                      f"frida-dexdump -U -f {pkg} -o {outdir}")
            return
        if not sh(["adb", "-s", serial, "shell", "pidof", "frida-server"], timeout=8)[1].strip():
            self.record("1b-unpack", "needs_device", f"device {serial} present but frida-server not running")
            self.need("frida-server", "start frida-server, then dump the released DEX",
                      f"python tools/adapters/frida_server.py  # then: frida-dexdump -U -f {pkg} -o {outdir}")
            return
        fdd = ensure_tool("frida-dexdump") or "frida-dexdump"
        os.makedirs(outdir, exist_ok=True)
        print(f"  [unpack] {os.path.basename(str(fdd))} -U -f {pkg} → unpacked/  (spawns app, dumps released DEX)")
        rc, o, e = sh([fdd, "-U", "-f", pkg, "-o", outdir], timeout=300)
        dex = [f for f in os.listdir(outdir) if f.endswith(".dex")] if os.path.isdir(outdir) else []
        if dex:
            self.record("1b-unpack", "ok", f"dumped {len(dex)} real DEX → unpacked/ (decompile THESE, not the stub)", outdir)
        else:
            self.record("1b-unpack", "partial", f"frida-dexdump returned no DEX: {(e or o).strip()[:80]}")
            self.need("unpack", "frida-dexdump got nothing — try a stronger unpacker",
                      f"python tools/fetch.py frida-dex-dump   # or BlackDex / youpk / fart from catalog")

    def static(self):
        out = self.d("03-static", "findings.json")
        if self.have("03-static/findings.json"):
            self.record("3-static", "cached", "findings.json present"); return
        os.makedirs(self.d("03-static"), exist_ok=True)
        fw = (self._fp().get("app_framework") or "").lower()
        if "hermes" in fw:
            base = self._first_intake_apk()
            if not base:
                self.record("3-static", "blocked", "no apk in 00-intake/ for Hermes string dump")
                return
            sfile = self.d("03-static", "strings.txt")
            sh([PY, os.path.join(HERE, "hermes_strings.py"), base, "-o", sfile, "--unique"], timeout=600)
            grep = {}
            if os.path.exists(sfile):
                txt = open(sfile, encoding="utf-8", errors="ignore").read()
                import re
                grep["api_hosts"] = sorted(set(re.findall(r"\b[a-z0-9.-]+\.[a-z]{2,}/[a-z0-9/_-]*", txt)))[:25]
                grep["auth_hints"] = sorted({w for w in re.findall(r"[A-Za-z-]{3,40}", txt)
                                             if re.search(r"(?i)bearer|hmac|signature|x-[a-z]+-|token|secret", w)})[:25]
            findings = {"phase": "static", "status": "ok",
                        "findings": [{"type": "constant", "detail": "Hermes string table dumped", "evidence": "03-static/strings.txt"}],
                        "endpoints": grep.get("api_hosts", []), "auth_hints": grep.get("auth_hints", []),
                        "open_questions": ["confirm the real signing header via dynamic capture"],
                        "next_suggested": "dynamic (frida-mitm) to capture a real request"}
            json.dump(findings, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
            self.record("3-static", "ok", f"{len(grep.get('auth_hints', []))} auth hints, {len(grep.get('api_hosts', []))} hosts", out)
        else:
            jadx = ensure_tool("jadx") if self.type == "android" else None
            if jadx and self.type == "android":
                apk = self._first_intake_apk()
                if not apk:
                    self.record("3-static", "blocked", "no apk in 00-intake/ for jadx")
                    return
                self.record("3-static", "needs_human", "jadx available — decompile + grep endpoints (not auto-parsed yet)")
                self.need("static-parse", "jadx decompile output not auto-parsed",
                          f"{jadx} -d {self.d('03-static','jadx')} {apk}")
            else:
                self.record("3-static", "needs_tool", f"no headless static path wired for framework '{fw or self.type}'")

    def _rank_sos(self):
        """Score every .so across the acquired apks by detection/crypto signal; return ranked list."""
        ranked = []
        intake = self.d("00-intake")
        for f in (os.listdir(intake) if os.path.isdir(intake) else []):
            if not f.endswith(".apk"):
                continue
            try:
                z = zipfile.ZipFile(self.d("00-intake", f))
            except Exception:
                continue
            for n in z.namelist():
                if not n.endswith(".so"):
                    continue
                base = os.path.basename(n)
                score, why = 0, []
                if SO_NAME_SIGNAL.search(base):
                    score += 50; why.append("name")
                if SO_NOISE.search(base):
                    score -= 35
                try:
                    data = z.read(n)[:20_000_000]
                except Exception:
                    data = b""
                for kw in STR_SIGNALS:
                    c = data.count(kw)
                    if c:
                        score += min(c, 5) * 2; why.append(kw.decode("latin1"))
                ranked.append({"so": n, "apk": f, "score": score, "signals": why[:8]})
            z.close()
        ranked.sort(key=lambda r: r["score"], reverse=True)
        return ranked

    def native(self):
        out = self.d("05-native", "findings.json")
        ranked = self._rank_sos()
        if not ranked:
            self.record("5-native", "skipped", "no native .so to analyse"); return
        top = ranked[0]
        if top["score"] <= 0:
            self.record("5-native", "skipped", f"{len(ranked)} .so but none score on detection/crypto (likely all framework libs)")
            return
        if self.have("05-native/decomp.c") and self.have("05-native/findings.json"):
            self.record("5-native", "cached", f"already analysed (top={os.path.basename(top['so'])})"); return
        hl = resolve_ghidra_headless()
        if not hl:
            ensure_tool("ghidra")          # auto-fetch Ghidra into the project (tools/bin)
            hl = resolve_ghidra_headless()
        if not hl:
            self.record("5-native", "needs_tool",
                        f"auto-picked {os.path.basename(top['so'])} (score {top['score']}) but Ghidra unavailable (fetch failed?)")
            self.need("ghidra", "headless native decompile needs Ghidra",
                      "python tools/fetch.py ghidra  (or set GHIDRA_INSTALL_DIR) ; then re-run auto_reverse.py")
            return
        # ── auto-extract the top-scored .so and decompile it headlessly ──
        libdir = self.d("05-native", "lib"); os.makedirs(libdir, exist_ok=True)
        with zipfile.ZipFile(self.d("00-intake", top["apk"])) as z:
            dst = os.path.join(libdir, os.path.basename(top["so"]))
            with z.open(top["so"]) as src, open(dst, "wb") as fo:
                shutil.copyfileobj(src, fo)
        decomp = self.d("05-native", "decomp.c")
        proj = self.d("05-native", "ghidra-proj"); os.makedirs(proj, exist_ok=True)
        scripts = os.path.join(HERE, "ghidra_scripts")
        rc, o, e = sh([hl, proj, "auto", "-import", dst, "-overwrite",
                       "-scriptPath", scripts, "-postScript", "DumpDecomp.java", decomp], timeout=1200)
        # ── grep decompiled C + raw .so for detection/crypto evidence ──
        sigs, jni = {}, []
        if os.path.exists(decomp):
            ctext = open(decomp, encoding="utf-8", errors="ignore").read()
            for kw in ("ptrace", "/proc/self/maps", "/proc/self/task", "frida", "Frida",
                       "/data/local/tmp", "which su", "magisk", "AES", "HMAC", "RSA", "SHA"):
                c = ctext.count(kw)
                if c:
                    sigs[kw] = c
        try:
            raw = open(dst, "rb").read()
            jni = sorted(set(re.findall(r"Java_[A-Za-z0-9_]+", raw.decode("latin1"))))[:20]
        except Exception:
            pass
        nfuncs = re.search(r"decompiled (\d+) functions", o or "")
        findings = {
            "phase": "native", "status": "ok" if os.path.exists(decomp) else "partial",
            "auto_selected": {"lib": top["so"], "score": top["score"], "signals": top["signals"]},
            "ranking": [{"so": os.path.basename(r["so"]), "score": r["score"]} for r in ranked[:6]],
            "findings": [
                {"type": "constant", "detail": f"auto-picked {os.path.basename(top['so'])} (score {top['score']}); "
                 f"decompiled {nfuncs.group(1) if nfuncs else '?'} functions headless", "evidence": "05-native/decomp.c"},
                {"type": "algorithm", "detail": f"JNI exports: {', '.join(jni) if jni else '(stripped/none)'}",
                 "evidence": "strings of the .so"},
                {"type": "param", "detail": f"detection/crypto signal counts in decompiled C: {sigs or '(none)'}",
                 "evidence": "grep over decomp.c"},
            ],
            "open_questions": ["Does the SDK gate request signing on a clean verdict, or only detect+report?"],
            "next_suggested": "frida-hook the JNI detectors to force a clean verdict (if it gates), else proceed",
            "method_note": "fully automatic: ranked all .so by detection/crypto signal, extracted the top, "
                           "analyzeHeadless + DumpDecomp.java — no GUI, no human picked the target.",
        }
        os.makedirs(self.d("05-native"), exist_ok=True)
        json.dump(findings, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        self.record("5-native", findings["status"],
                    f"auto-target {os.path.basename(top['so'])} (score {top['score']}); "
                    f"{len(jni)} JNI exports; signals={list(sigs)[:5]}", out)

    def _adb_device(self):
        if self.device:
            return self.device
        rc, o, e = sh(["adb", "devices"], timeout=8)
        lines = [l for l in o.splitlines()[1:] if "\tdevice" in l]
        return lines[0].split("\t")[0] if lines else None

    def _pkg(self):
        t = self.target
        if self.type == "android" and re.match(r"^[\w.]+$", t) and "." in t and not t.endswith(".apk"):
            return t
        return "<package>"

    def _unattended_capture(self, cap, sess, serial):
        """start_capture (bg frida+mitm) → ui_exercise (adb UI drive) → stop_analyze. Hands-off."""
        pkg = self._pkg()
        ensure_tool("frida"); ensure_tool("mitmproxy")   # auto-provision capture tools into the project
        os.makedirs(os.path.dirname(sess), exist_ok=True)
        print(f"  [dynamic] unattended capture: start → exercise → stop  (pkg={pkg})")
        rc, o, e = sh([PY, os.path.join(cap, "start_capture.py"), "-p", pkg, "-o", sess], timeout=180)
        if rc != 0:
            self.record("4-dynamic", "blocked", f"start_capture failed: {(e or o).strip()[:100]}")
            self.need("dynamic", "start_capture (frida/mitm setup) failed",
                      f"python {os.path.join(cap, 'start_capture.py')} -p {pkg} -o {sess}")
            return
        time.sleep(5)
        ui = [PY, os.path.join(HERE, "ui_exercise.py"), "--serial", serial]
        ui += (["--flow", self.flow] if self.flow else ["--launch", pkg, "--generic"])
        sh(ui, timeout=240)
        time.sleep(3)
        rc, o, e = sh([PY, os.path.join(cap, "stop_analyze.py"), "-o", sess, "--full"], timeout=180)
        summ = self.d("04-dynamic", "findings.json")
        json.dump({"phase": "dynamic", "status": "ok" if rc == 0 else "partial",
                   "findings": [{"type": "endpoint",
                                 "detail": f"unattended capture of {pkg} (flow={'yes' if self.flow else 'generic'})",
                                 "evidence": "04-dynamic/session/"}],
                   "open_questions": ["which captured request carries the signed field?"],
                   "next_suggested": "diff signed fields across requests; synthesize the signer",
                   "method_note": "hands-off: start_capture (frida+mitm, bg) → ui_exercise (adb UI drive) → stop_analyze"},
                  open(summ, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        self.record("4-dynamic", "ok" if rc == 0 else "partial", f"unattended capture → {sess}", summ)

    def dynamic_and_verify(self):
        # dynamic: auto-detect device + frida-server; tee up the exact capture command (don't fake traffic)
        cap = os.path.join(ROOT, "skills", "android", "frida-mitm-capture", "scripts")
        sess = self.d("04-dynamic", "session")
        if self.type != "android":
            self.record("4-dynamic", "needs_human", f"{self.type} dynamic capture: use cdp-browser (web) / a proxy")
        else:
            serial = self._adb_device()
            if not serial:
                self.record("4-dynamic", "needs_device", "no adb device connected for traffic capture")
                self.need("device", "connect a rooted device + run frida-server, then capture",
                          f"python {os.path.join(cap, 'start_capture.py')} -p {self._pkg()} -o {sess}")
            else:
                frida_on = bool(sh(["adb", "-s", serial, "shell", "pidof", "frida-server"], timeout=8)[1].strip())
                if frida_on and self.auto_capture and self._pkg() != "<package>":
                    self._unattended_capture(cap, sess, serial)
                elif frida_on:
                    self.record("4-dynamic", "ready",
                                f"device {serial} + frida-server live → unattended capture available (--auto-capture)")
                    self.need("dynamic-capture", f"hands-off: add --auto-capture (drives the UI via ui_exercise), or run manually (device {serial})",
                              f"python tools/auto_reverse.py {self._pkg()} --device {serial} --auto-capture [--flow flow.json]")
                else:
                    self.record("4-dynamic", "needs_device", f"device {serial} present but frida-server not running")
                    self.need("frida-server", f"push+run frida-server on {serial}, then capture",
                              f"python tools/adapters/frida_server.py  # then start_capture.py -p {self._pkg()} -o {sess}")
        # verify: needs a synthesized request from Phase 6, then the oracle closes the loop
        self.record("7-verify", "needs_data", "oracle replay needs 06-synthesize/request.json")
        self.need("verify", "once an algorithm is synthesized, verify it (closes the loop)",
                  f"python tools/oracle.py replay --from {self.d('06-synthesize', 'request.json')} --expect-status 200")

    def finalize(self):
        status = {"target": self.target, "type": self.type, "slug": self.slug,
                  "phases": self.phases, "next_actions": self.actions}
        json.dump(status, open(self.d("status.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        # report.md
        lines = [f"# auto_reverse report — `{self.target}`", "",
                 f"- type: **{self.type}**  ·  workspace: `{self.display_base()}/`", "",
                 "## Phase status", "", "| phase | status | notes |", "|---|---|---|"]
        for p in self.phases:
            lines.append(f"| {p['phase']} | {p['status']} | {p['notes']} |")
        if self.actions:
            lines += ["", "## NEXT ACTIONS (need device / human / tool)", ""]
            for a in self.actions:
                lines.append(f"- **{a['need']}** — {a['why']}\n  ```\n  {a['command']}\n  ```")
        lines += ["", "_Generated by tools/auto_reverse.py — the headless spine is automated; "
                  "items above are the honest hand-offs._", ""]
        open(self.d("report.md"), "w", encoding="utf-8").write("\n".join(lines))
        print(f"\n→ {self.display_base()}/status.json + report.md written "
              f"({sum(1 for p in self.phases if p['status'] in ('ok','cached'))}/{len(self.phases)} phases done, "
              f"{len(self.actions)} hand-offs)")

    def go(self):
        print(f"[auto_reverse] target={self.target} type={self.type} → {self.display_base()}/")
        self.init(); self.intake(); self.fingerprint(); self.unpack(); self.plan()
        self.static(); self.native(); self.dynamic_and_verify(); self.finalize()


def main():
    ap = argparse.ArgumentParser(description="headless from-zero autonomous reversing driver")
    ap.add_argument("target", help="apk/so/exe file path, android package id, or http(s) URL")
    ap.add_argument("--type", choices=["android", "ios", "web", "windows", "native"])
    ap.add_argument("--device", help="adb serial (for android package-id acquisition)")
    ap.add_argument("--force", action="store_true", help="redo phases even if artifacts exist")
    ap.add_argument("--auto-capture", action="store_true",
                    help="hands-off dynamic capture: drive the UI via ui_exercise while capturing (needs device+frida)")
    ap.add_argument("--flow", help="flow.json for ui_exercise (deterministic taps); else generic exercise")
    ap.add_argument("--workspace-root",
                    help="workspace root directory (default: <repo>/workspace)")
    args = ap.parse_args()
    Run(args.target, args.type, args.device, args.force, args.auto_capture, args.flow,
        args.workspace_root).go()


if __name__ == "__main__":
    main()
