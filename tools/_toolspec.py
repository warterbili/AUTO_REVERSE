#!/usr/bin/env python3
"""
_toolspec.py — machine-readable tool specification table (shared by doctor.py / fetch.py).

Design principles:
- Pure stdlib, zero third-party dependencies (doctor must run even when nothing is installed yet).
- Tools land in one of two locations, both **inside the project directory**, never touching the user's global environment:
    * pip tools    -> project venv:  <project>/.venv
    * binary tools -> project bin:    <project>/tools/bin/<id>/
- doctor resolution order: project venv -> project tools/bin -> system PATH (skip download if already present).
- On-demand download: fetch <id> is invoked only when a tool is actually needed and missing, never bulk-downloaded at clone time.
- alt: fallback tool ids (substitutes used when the primary tool is unavailable or inapplicable).
"""
import os
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BIN_DIR = PROJECT_ROOT / "tools" / "bin"
VENV_DIR = PROJECT_ROOT / ".venv"

IS_WIN = os.name == "nt"
OSKEY = "win" if IS_WIN else ("mac" if sys.platform == "darwin" else "linux")


def venv_scripts():
    return VENV_DIR / ("Scripts" if IS_WIN else "bin")


def venv_bin(name):
    """Executable inside the project venv (with .exe suffix on Windows)."""
    p = venv_scripts() / (name + (".exe" if IS_WIN else ""))
    return p if p.exists() else None


def project_bin(tool_id, rel):
    """Executable inside project tools/bin/<id>/<rel>."""
    p = BIN_DIR / tool_id / rel
    return p if p.exists() else None


# kind:
#   pip          — pip package, installed into the project venv; run=console script name
#   npm          — npm package, installed into project tools/bin/<id>/node_modules
#   github-jar   — a single jar from a GitHub release
#   github-zip   — a zip from a GitHub release, extracted and bin_subpath taken from it
#   runtime      — runtime (python/java/node); not auto-downloaded, official site provided instead
TOOLS = {
    # ── Runtimes (prerequisites; not auto-downloaded, doctor only detects + points to official site) ──
    "python": {"kind": "runtime", "domain": "runtime", "bin": "python",
               "url": "https://www.python.org/downloads/", "min": "3.10+"},
    "java":   {"kind": "runtime", "domain": "runtime", "bin": "java",
               "url": "https://adoptium.net/", "min": "JDK17+ (Ghidra requires JDK21)"},
    "node":   {"kind": "runtime", "domain": "runtime", "bin": "node",
               "url": "https://nodejs.org/", "min": "18+"},
    "adb":    {"kind": "runtime", "domain": "android", "bin": "adb",
               "url": "https://developer.android.com/tools/releases/platform-tools",
               "note": "Android platform-tools; after extracting, add the directory to PATH"},

    # ── Android static ──
    "jadx": {"kind": "github-zip", "domain": "android", "bin": "jadx",
             "repo": "skylot/jadx", "asset": r"jadx-\d.*\.zip",
             "bin_subpath": "bin/jadx.bat" if IS_WIN else "bin/jadx",
             "alt": ["gda"], "url": "https://github.com/skylot/jadx/releases"},
    "apktool": {"kind": "github-jar", "domain": "android", "bin": "apktool",
                "repo": "iBotPeaches/Apktool", "asset": r"apktool.*\.jar",
                "url": "https://github.com/iBotPeaches/Apktool/releases",
                "note": "after downloading the jar, an apktool launcher is generated (handled automatically by fetch)"},
    "gda": {"kind": "github-zip", "domain": "android", "bin": "GDA",
            "repo": "charles2gan/GDA-android-reversing-Tool", "asset": r"gda.*\.zip",
            "bin_subpath": "GDA.exe", "os": ["win"], "alt": ["jadx"],
            "url": "https://github.com/charles2gan/GDA-android-reversing-Tool/releases",
            "note": "native Windows GUI; a fallback second opinion to jadx"},

    # ── Android dynamic ──
    "frida": {"kind": "pip", "domain": "android", "pkg": "frida-tools", "run": "frida",
              "url": "https://github.com/frida/frida",
              "note": "host side; the device-side frida-server is fetched separately via fetch frida-server"},
    "frida-server": {"kind": "github-asset", "domain": "android", "bin": None,
                     "repo": "frida/frida", "asset": r"frida-server-.*-android-arm64\.xz",
                     "url": "https://github.com/frida/frida/releases",
                     "note": "device-side binary; version must match the host frida and architecture must match the device abi"},
    "objection": {"kind": "pip", "domain": "android", "pkg": "objection", "run": "objection",
                  "url": "https://github.com/sensepost/objection"},
    "frida-dexdump": {"kind": "pip", "domain": "android", "pkg": "frida-dexdump",
                      "run": "frida-dexdump", "url": "https://github.com/hluwa/frida-dexdump"},
    "mitmproxy": {"kind": "pip", "domain": "android", "pkg": "mitmproxy", "run": "mitmdump",
                  "url": "https://github.com/mitmproxy/mitmproxy"},
    "apk-mitm": {"kind": "npm", "domain": "android", "pkg": "apk-mitm", "run": "apk-mitm",
                 "alt": ["objection"], "url": "https://github.com/niklashigi/apk-mitm"},

    # ── Native ──
    "ghidra": {"kind": "github-zip", "domain": "native", "bin": "ghidraRun",
               "repo": "NationalSecurityAgency/ghidra", "asset": r"ghidra_.*_PUBLIC.*\.zip",
               "bin_subpath": "ghidraRun.bat" if IS_WIN else "ghidraRun",
               "env_home": "GHIDRA_HOME",
               "alt": ["ida-pro"], "url": "https://github.com/NationalSecurityAgency/ghidra/releases",
               "note": "free IDA alternative; requires JDK21; set GHIDRA_HOME to the extracted directory"},
    "ida-pro": {"kind": "runtime", "domain": "native", "bin": "idat", "optional": True,
                "url": "https://hex-rays.com/ida-pro/", "note": "commercial; requires a paid license; no pirated copies provided"},
    "capa": {"kind": "pip", "domain": "native", "pkg": "flare-capa", "run": "capa",
             "url": "https://github.com/mandiant/capa"},
    "floss": {"kind": "pip", "domain": "native", "pkg": "flare-floss", "run": "floss",
              "url": "https://github.com/mandiant/flare-floss"},
    "angr": {"kind": "pip", "domain": "native", "pkg": "angr", "run": None, "import": "angr",
             "url": "https://github.com/angr/angr", "note": "dependency of deflat"},

    # ── Web ──
    "playwright": {"kind": "npm", "domain": "web", "pkg": "playwright", "run": "playwright",
                   "url": "https://github.com/microsoft/playwright",
                   "note": "after install, run npx playwright install chromium"},
    # cdp-browser only needs Chrome + python websockets (see INSTALL.md)
    "websockets": {"kind": "pip", "domain": "web", "pkg": "websockets", "run": None,
                   "import": "websockets",
                   "url": "https://pypi.org/project/websockets/", "note": "dependency of cdp-browser"},
}


def resolve(tool_id):
    """Return (status, location). status is one of present-venv|present-bin|present-path|missing."""
    spec = TOOLS.get(tool_id)
    if not spec:
        return "unknown", None
    # pip: run script in the project venv -> system PATH
    if spec["kind"] == "pip":
        run = spec.get("run")
        if run:
            v = venv_bin(run)
            if v:
                return "present-venv", str(v)
            p = shutil.which(run)
            if p:
                return "present-path", p
        else:
            # Libraries without a run script (angr/websockets): considered installed if the current interpreter can import them
            import importlib.util
            mod = spec.get("import", spec["pkg"])
            try:
                if importlib.util.find_spec(mod) is not None:
                    return "present-path", f"import {mod}"
            except Exception:
                pass
        return "missing", None
    if spec["kind"] == "npm":
        b = project_bin(tool_id, "node_modules/.bin/" + spec["run"] + (".cmd" if IS_WIN else ""))
        if b:
            return "present-bin", str(b)
        p = shutil.which(spec["run"])
        return ("present-path", p) if p else ("missing", None)
    if spec["kind"] in ("github-zip", "github-jar"):
        sub = spec.get("bin_subpath") or (spec.get("bin", tool_id))
        b = project_bin(tool_id, sub)
        if b:
            return "present-bin", str(b)
        # Installation directory pointed to by an environment variable (e.g. GHIDRA_HOME)
        eh = spec.get("env_home")
        if eh and os.environ.get(eh):
            cand = Path(os.environ[eh]) / sub
            if cand.exists():
                return "present-path", str(cand)
        if spec.get("bin"):
            p = shutil.which(spec["bin"])
            if p:
                return "present-path", p
        # Separate detection for jars
        if spec["kind"] == "github-jar":
            jars = list((BIN_DIR / tool_id).glob("*.jar")) if (BIN_DIR / tool_id).exists() else []
            if jars:
                return "present-bin", str(jars[0])
        return "missing", None
    if spec["kind"] in ("runtime", "github-asset"):
        b = spec.get("bin")
        if b:
            p = shutil.which(b)
            if p:
                return "present-path", p
        return "missing", None
    return "missing", None
