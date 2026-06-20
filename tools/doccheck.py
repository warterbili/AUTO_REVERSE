#!/usr/bin/env python3
"""
doccheck.py — fail CI when the docs drift from reality. Mechanises the "numbers" rows of
the upgrade sync-matrix (see CONTRIBUTING.md) so a stale count can't slip in by hand —
exactly the `640+`/`125+` drift this guards against.

  python tools/doccheck.py

Checks (against the live catalog/ + skills/):
  • per-domain coverage floors in README (EN+zh) are still TRUE (floor <= actual)
  • the "N bundled skills" claim is exact
  • the catalog-total floor (badge + headline + brain/SKILL.md + AGENTS.md) is still TRUE
  • WARNS when a floor lags reality by >= STALE (advisory: bump it)

Errors exit 1 (CI gate); warnings are advisory. Requires pyyaml.
"""
import glob
import os
import re
import sys

try:
    import yaml
except ImportError:
    print("pyyaml required: pip install pyyaml"); sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STALE = 25  # warn when actual exceeds a stated floor by this much

# README coverage-table header order -> catalog file stem
DOMAIN_COLS = ["web", "native", "mcp", "android", "ios", "frameworks", "windows"]


def actual():
    counts = {}
    for f in glob.glob(os.path.join(ROOT, "catalog", "*.yaml")):
        stem = os.path.basename(f)[:-5]
        if stem == "targets":
            continue
        counts[stem] = len(re.findall(r"\{id:", open(f, encoding="utf-8").read()))
    total = sum(counts.values())
    skills = len(glob.glob(os.path.join(ROOT, "skills", "**", "SKILL.md"), recursive=True))
    return total, counts, skills


def floor(text, pattern):
    m = re.search(pattern, text)
    return int(m.group(1)) if m else None


def main():
    total, dom, skills = actual()
    errors, warns = [], []

    def chk_floor(label, claimed, real):
        if claimed is None:
            return
        if claimed > real:
            errors.append(f"{label}: claims {claimed}+ but actual is {real} (floor is now FALSE)")
        elif real - claimed >= STALE:
            warns.append(f"{label}: says {claimed}+ but actual is {real} (stale by {real - claimed} — bump it)")

    for rd in ("README.md", "README.zh-CN.md"):
        p = os.path.join(ROOT, rd)
        if not os.path.exists(p):
            continue
        t = open(p, encoding="utf-8").read()
        chk_floor(f"{rd} badge", floor(t, r"catalog-(\d+)%2B"), total)
        chk_floor(f"{rd} headline", floor(t, r"(\d+)\+ (?:routed capabilities|个可路由能力)"), total)
        # skills count is stated exact, not a floor
        sc = floor(t, r"(\d+) (?:bundled skills|个内置技能)")
        if sc is not None and sc != skills:
            errors.append(f"{rd}: claims {sc} bundled skills but actual is {skills}")
        # per-domain coverage table: the row of **N+** cells, in DOMAIN_COLS order
        row = re.search(r"\|\s*\*\*(\d+)\+\*\*\s*\|\s*\*\*(\d+)\+\*\*\s*\|\s*\*\*(\d+)\+\*\*\s*\|"
                        r"\s*\*\*(\d+)\+\*\*\s*\|\s*\*\*(\d+)\+\*\*\s*\|\s*\*\*(\d+)\+\*\*\s*\|\s*\*\*(\d+)\+\*\*\s*\|", t)
        if row:
            for i, d in enumerate(DOMAIN_COLS):
                chk_floor(f"{rd} {d} column", int(row.group(i + 1)), dom.get(d, 0))

    for f, pat in (("brain/SKILL.md", r"\((\d+)\+ entries"), ("AGENTS.md", r"\*\*(\d+)\+ capabilities\*\*|(\d+)\+ capabilities|(\d+)\+ entries")):
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            t = open(p, encoding="utf-8").read()
            m = re.search(pat, t)
            if m:
                chk_floor(f"{f} catalog count", int(next(g for g in m.groups() if g)), total)

    print(f"doccheck: catalog total={total}, skills={skills}, per-domain={dom}")
    for w in warns:
        print(f"  ⚠ {w}")
    for e in errors:
        print(f"  ✗ {e}")
    print(f"doccheck: {len(errors)} error(s), {len(warns)} warning(s)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
