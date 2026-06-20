#!/usr/bin/env python3
"""
fetch.py — download/install a given tool on demand **inside the project directory** (never touching the user's global environment).

Landing locations:
  pip tools   -> <project>/.venv          (project-specific virtual environment)
  npm tools   -> <project>/tools/bin/<id>/
  jar/zip     -> <project>/tools/bin/<id>/

Usage:
  python tools/fetch.py jadx            # download jadx into tools/bin/jadx/
  python tools/fetch.py mitmproxy       # install into the project .venv
  python tools/fetch.py --list          # list all fetchable tools
On-demand philosophy: download only what you use, not everything on clone. Zero third-party dependencies (urllib/zipfile/lzma/venv).
"""
import argparse
import json
import lzma
import os
import re
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _toolspec import TOOLS, BIN_DIR, VENV_DIR, venv_scripts, IS_WIN, OSKEY  # noqa: E402

UA = {"User-Agent": "auto-reverse-fetch"}


def log(m): print(f"[fetch] {m}")


def http_get(url, dest=None):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if dest:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(data)
        return dest
    return data


def gh_asset(repo, pattern, tag=None):
    """Find the asset matching pattern in a GitHub release; tag=None picks latest, otherwise the specified version."""
    if tag:
        api = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
    else:
        api = f"https://api.github.com/repos/{repo}/releases/latest"
    rel = json.loads(http_get(api).decode())
    for a in rel.get("assets", []):
        if re.search(pattern, a["name"]):
            return a["browser_download_url"], a["name"]
    raise RuntimeError(f"{repo} release({tag or 'latest'}) has no asset matching {pattern}")


def host_frida_version():
    """Host-side frida version — frida-server must match it exactly."""
    try:
        out = subprocess.run(["frida", "--version"], capture_output=True, text=True, timeout=15)
        v = out.stdout.strip()
        return v or None
    except Exception:
        return None


def ensure_venv():
    if not (venv_scripts()).exists():
        log(f"creating project venv -> {VENV_DIR}")
        subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)
    pip = venv_scripts() / ("pip.exe" if IS_WIN else "pip")
    return str(pip)


def fetch_pip(tid, spec):
    pip = ensure_venv()
    log(f"installing {spec['pkg']} into project venv ...")
    subprocess.run([pip, "install", "--upgrade", spec["pkg"]], check=True)
    log(f"✅ {tid} → {venv_scripts()}")


def fetch_npm(tid, spec):
    dest = BIN_DIR / tid
    dest.mkdir(parents=True, exist_ok=True)
    npm = "npm.cmd" if IS_WIN else "npm"
    log(f"npm installing {spec['pkg']} -> {dest}")
    subprocess.run([npm, "install", "--prefix", str(dest), spec["pkg"]], check=True)
    if tid == "playwright":
        log("installing Chromium: npx playwright install chromium")
        subprocess.run([("npx.cmd" if IS_WIN else "npx"), "playwright", "install", "chromium"],
                       cwd=str(dest), check=False)
    log(f"✅ {tid} → {dest}")


def fetch_jar(tid, spec):
    url, name = gh_asset(spec["repo"], spec["asset"])
    dest = BIN_DIR / tid / name
    log(f"downloading {name} -> {dest}")
    http_get(url, dest)
    # write a launcher for convenient direct invocation
    launcher_dir = BIN_DIR / tid
    if IS_WIN:
        (launcher_dir / f"{tid}.bat").write_text(
            f'@echo off\njava -jar "%~dp0{name}" %*\n', encoding="ascii")
    else:
        sh = launcher_dir / tid
        sh.write_text(f'#!/bin/sh\njava -jar "$(dirname "$0")/{name}" "$@"\n')
        os.chmod(sh, 0o755)
    log(f"✅ {tid} -> {dest}  (launcher: {launcher_dir / (tid + ('.bat' if IS_WIN else '')) })")


def fetch_zip(tid, spec):
    url, name = gh_asset(spec["repo"], spec["asset"])
    dest = BIN_DIR / tid
    dest.mkdir(parents=True, exist_ok=True)
    zpath = dest / name
    log(f"downloading {name} ...")
    http_get(url, zpath)
    log(f"extracting -> {dest}")
    with zipfile.ZipFile(zpath) as z:
        z.extractall(dest)
    # locate bin_subpath (there may be an extra top-level directory)
    sub = spec.get("bin_subpath")
    if sub and not (dest / sub).exists():
        for top in dest.iterdir():
            if top.is_dir() and (top / sub).exists():
                log(f"executable: {top / sub}")
                break
    log(f"✅ {tid} → {dest}")


def fetch_asset(tid, spec):
    tag = None
    if tid == "frida-server":
        hv = host_frida_version()
        if hv:
            tag = hv  # the frida release tag is the version number, e.g. 17.7.3
            log(f"host frida={hv} -> fetching the matching frida-server version (versions must match)")
        else:
            log("host frida not detected, falling back to latest; after install, ensure the version matches the host frida")
    url, name = gh_asset(spec["repo"], spec["asset"], tag=tag)
    dest = BIN_DIR / tid
    dest.mkdir(parents=True, exist_ok=True)
    xz = dest / name
    log(f"downloading {name} -> {dest}")
    http_get(url, xz)
    if name.endswith(".xz"):
        out = dest / name[:-3]
        log(f"extracting xz -> {out}")
        out.write_bytes(lzma.decompress(xz.read_bytes()))
        if tid == "frida-server":
            log("note: frida-server is a device-side binary. Push it to the device with the adapter:"
                f"\n  set FRIDA_SERVER_BIN={out}  &&  python tools/adapters/frida_server.py")
    log(f"✅ {tid} → {dest}")


DISPATCH = {"pip": fetch_pip, "npm": fetch_npm, "github-jar": fetch_jar,
            "github-zip": fetch_zip, "github-asset": fetch_asset}


def find_install(tool):
    """Look up an `install` command for `tool` in tools/registry.yaml or catalog/*.yaml.

    The curated TOOLS set in _toolspec.py covers the common path with zero deps; this
    fallback fulfils the brain's promise that *any* `bundled:false` catalog id is
    fetchable via `fetch.py <id>`. Returns (install_cmd, url) or (None, None).
    Requires pyyaml (a dev dependency) for this extended path only.
    """
    try:
        import yaml
    except ImportError:
        return ("__NO_YAML__", None)
    root = Path(__file__).resolve().parent.parent
    reg = root / "tools" / "registry.yaml"
    if reg.exists():
        doc = yaml.safe_load(reg.read_text(encoding="utf-8")) or {}
        for section in doc.values():
            if isinstance(section, list):
                for e in section:
                    if isinstance(e, dict) and e.get("id") == tool and e.get("install"):
                        return (e["install"], e.get("url"))
    for cat in sorted((root / "catalog").glob("*.yaml")):
        if cat.name == "targets.yaml":
            continue
        doc = yaml.safe_load(cat.read_text(encoding="utf-8")) or {}
        for e in doc.get("entries", []):
            if isinstance(e, dict) and e.get("id") == tool and e.get("install"):
                return (e["install"], e.get("source"))
    return (None, None)


def provision_from_install(tool, install):
    """Run a catalog/registry `install` command, routing pip installs into the project venv."""
    install = install.strip()
    log(f"provisioning '{tool}' from catalog/registry: {install}")
    m = re.match(r"^pip3?\s+install\s+(.+)$", install)
    if m:
        pip = ensure_venv()
        subprocess.run([pip, "install", "--upgrade", *m.group(1).split()], check=True)
        log(f"✅ {tool} → {venv_scripts()}")
        return
    if install.startswith("git clone"):
        dest = BIN_DIR / tool
        dest.mkdir(parents=True, exist_ok=True)
        subprocess.run(install, shell=True, cwd=str(dest), check=True)
        log(f"✅ {tool} → {dest}")
        return
    log("running the install command as-is (npm -g / release URL — may touch the global environment)")
    subprocess.run(install, shell=True, check=True)
    log(f"✅ {tool}")


def main():
    ap = argparse.ArgumentParser(description="download tools on demand into the project")
    ap.add_argument("tool", nargs="?", help="tool id (see --list)")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list or not args.tool:
        print("Fetchable tools (downloaded when needed, landing inside the project):")
        for tid, sp in TOOLS.items():
            if sp["kind"] == "runtime":
                continue
            print(f"  {tid:<14} [{sp.get('domain')}] {sp['kind']:<12} {sp.get('url','')}")
        print("\nruntimes (install manually): python / java / node / adb -- see tools/INSTALL.md")
        return

    spec = TOOLS.get(args.tool)
    if not spec:
        # Fallback: provision any bundled:false catalog/registry tool via its install command.
        install, url = find_install(args.tool)
        if install == "__NO_YAML__":
            log(f"unknown tool {args.tool}. Curated set: --list. To resolve from the "
                f"full catalog, install pyyaml first: pip install pyyaml")
            sys.exit(1)
        if not install:
            log(f"unknown tool {args.tool} (not in the curated set, registry.yaml, or catalog/*.yaml). "
                f"Run python tools/fetch.py --list, or check the entry's 'install' field.")
            sys.exit(1)
        try:
            provision_from_install(args.tool, install)
        except Exception as e:
            log(f"❌ failed: {e}\nmanual install: {url or '(see the catalog entry)'}")
            sys.exit(1)
        return
    if spec["kind"] == "runtime":
        log(f"{args.tool} is a runtime, please install it manually -> {spec['url']}")
        sys.exit(0)
    if spec.get("os") and OSKEY not in spec["os"]:
        log(f"{args.tool} is not applicable to the current OS ({OSKEY}); fallback: {spec.get('alt')}")
        sys.exit(1)
    try:
        DISPATCH[spec["kind"]](args.tool, spec)
    except Exception as e:
        log(f"❌ failed: {e}\nmanual download: {spec.get('url')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
