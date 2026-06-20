#!/usr/bin/env python3
"""
smoketest.py — turn the catalog from an *unverified routing index* into a *tested* one.

Two modes:

  python tools/smoketest.py lint            # OFFLINE, fast (CI default): structural checks
  python tools/smoketest.py probe --sample 20   # ONLINE: does the install target actually exist?
  python tools/smoketest.py probe --id humanify,varbert   # probe specific ids
  python tools/smoketest.py probe --all     # ONLINE: probe every entry (slow)

`lint` flags malformed entries (install scheme unknown, source not an URL, placeholders).
`probe` is the one that catches the real bugs found by hand (fake pip packages like the old
`pip install varbert`/`llm4decompile`, dead git repos): it resolves the install WITHOUT
installing —
  git/clone/cargo --git  -> `git ls-remote <url>`
  pip install X          -> `pip index versions X`
  npm i [-g] X           -> `npm view X version`
Exit 1 if any checked entry fails, so CI can gate on it. Requires pyyaml.
"""
import argparse
import glob
import os
import re
import subprocess
import sys

try:
    import yaml
except ImportError:
    print("pyyaml required: pip install pyyaml"); sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KNOWN_SCHEMES = ("pip install", "pip3 install", "pipx", "npm i", "npm install", "npx",
                 "git clone", "cargo install", "cargo add", "r2pm", "go install", "go get",
                 "brew install", "apt", "gem install", "docker ", "opam install", "winget")
# free-text manual installs (download a release JAR/binary, etc.) are acceptable too
MANUAL_HINT = re.compile(r"(?i)download|release|\.jar|\.zip|binary|installer|extension")


def load_entries():
    out = []
    for f in glob.glob(os.path.join(ROOT, "catalog", "*.yaml")):
        if os.path.basename(f) in ("targets.yaml",):
            continue
        doc = yaml.safe_load(open(f, encoding="utf-8")) or {}
        for e in doc.get("entries", []):
            if isinstance(e, dict) and e.get("id"):
                out.append((os.path.basename(f), e))
    return out


def lint():
    """Errors fail CI; warnings are advisory (unusual-but-valid install schemes)."""
    errors, warns = 0, 0
    entries = load_entries()
    for fn, e in entries:
        where = f"{fn}:{e['id']}"
        inst, src = e.get("install"), str(e.get("source") or "")
        if e.get("bundled") is not False or e.get("type") not in ("tool", "script", "mcp"):
            continue
        # ── errors (real breakage) ──
        if "<" in (inst or "") or "<" in src or "your-org" in src:
            print(f"  ✗ {where}: placeholder left in install/source"); errors += 1
        if src and not src.startswith(("http://", "https://", "skills/")):
            print(f"  ✗ {where}: source not a URL/path: {src!r}"); errors += 1
        # ── warnings (double-check by hand / via probe) ──
        if inst and not any(inst.strip().startswith(s) for s in KNOWN_SCHEMES) \
                and not MANUAL_HINT.search(inst):
            print(f"  ⚠ {where}: unusual install scheme: {inst!r}"); warns += 1
    print(f"lint: {errors} error(s), {warns} warning(s) over {len(entries)} entries")
    return errors


def _run(cmd, timeout=40):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, (p.stdout + p.stderr).strip()
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def probe_one(e):
    """Return (status, detail). status in {ok, fail, skip}."""
    inst = (e.get("install") or "").strip()
    src = str(e.get("source") or "")
    # git / cargo --git / clone -> ls-remote the repo
    m = re.search(r"(https://github\.com/[\w.-]+/[\w.-]+)", inst) or \
        (re.match(r"https://github\.com/", src) and re.match(r"(https://github\.com/[\w.-]+/[\w.-]+)", src))
    url = None
    if "git clone" in inst or "cargo install --git" in inst:
        mm = re.search(r"(https?://\S+?)(?:\s|$)", inst.split("clone", 1)[-1] if "clone" in inst else inst)
        url = mm.group(1).rstrip("/.").rstrip("/") if mm else None
    if not url and src.startswith("https://github.com/"):
        url = "/".join(src.split("/")[:5])
    if inst.startswith(("pip install", "pip3 install")):
        pkg = inst.split("install", 1)[1].strip().split()[0]
        ok, out = _run([sys.executable, "-m", "pip", "index", "versions", pkg])
        return ("ok" if ok else "fail", f"pip:{pkg} {'found' if ok else 'NOT on PyPI'}")
    if inst.startswith(("npm i", "npm install")):
        pkg = re.sub(r"^npm (i|install)( -g| --global)?\s+", "", inst).split()[0]
        npm = "npm.cmd" if os.name == "nt" else "npm"
        ok, out = _run([npm, "view", pkg, "version"])
        return ("ok" if ok else "fail", f"npm:{pkg} {'found' if ok else 'NOT on npm'}")
    if url:
        ok, out = _run(["git", "ls-remote", url])
        return ("ok" if ok else "fail", f"repo {url} {'live' if ok else 'UNREACHABLE'}")
    return ("skip", f"no probeable install ({inst[:40] or 'none'})")


def probe(ids, sample, do_all):
    entries = load_entries()
    pool = [(fn, e) for fn, e in entries
            if e.get("bundled") is False and e.get("type") in ("tool", "script", "mcp")]
    if ids:
        sel = [(fn, e) for fn, e in pool if e["id"] in ids]
    elif do_all:
        sel = pool
    else:
        import random
        sel = random.sample(pool, min(sample, len(pool)))
    fails = 0
    for fn, e in sel:
        st, detail = probe_one(e)
        mark = {"ok": "✓", "fail": "✗", "skip": "·"}[st]
        if st != "skip":
            print(f"  {mark} {e['id']:<28} {detail}")
        if st == "fail":
            fails += 1
    print(f"probe: {len(sel)} checked, {fails} FAILED")
    return fails


def main():
    ap = argparse.ArgumentParser(description="catalog reliability smoke test")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("lint")
    p = sub.add_parser("probe")
    p.add_argument("--id", help="comma-separated ids to probe")
    p.add_argument("--sample", type=int, default=15)
    p.add_argument("--all", action="store_true")
    args = ap.parse_args()
    if args.cmd == "lint":
        sys.exit(1 if lint() else 0)
    ids = set(args.id.split(",")) if getattr(args, "id", None) else None
    sys.exit(1 if probe(ids, args.sample, args.all) else 0)


if __name__ == "__main__":
    main()
