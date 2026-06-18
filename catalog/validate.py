#!/usr/bin/env python3
"""
validate.py — verify that catalog/*.yaml entries have complete fields and globally unique ids.
Run after adding an entry: python catalog/validate.py
Requires pyyaml (a dev tool): pip install pyyaml
"""
import glob
import os
import re
import sys

try:
    import yaml
except ImportError:
    print("pyyaml is required: pip install pyyaml")
    sys.exit(2)

REQUIRED = ["id", "name", "type", "domain", "capability", "when_to_use", "source", "bundled", "status"]
TYPES = {"skill", "mcp", "tool", "script", "agent", "platform"}
STATUS = {"active", "slowed", "archived", "commercial"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
# file (without .yaml) -> expected domain; mcp.yaml is intentionally cross-domain (skip)
FILE_DOMAIN = {"android": "android", "ios": "ios", "native": "native",
               "windows": "windows", "web": "web", "frameworks": "framework"}
INSTALLABLE = {"tool", "script", "mcp"}

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    seen, errors, warnings, total = {}, [], [], 0
    for f in sorted(glob.glob(os.path.join(HERE, "*.yaml"))):
        base = os.path.basename(f)
        fdom = FILE_DOMAIN.get(base[:-5])  # strip .yaml
        doc = yaml.safe_load(open(f, encoding="utf-8")) or {}
        for e in doc.get("entries", []):
            total += 1
            where = f"{base}:{e.get('id','<no-id>')}"
            for k in REQUIRED:
                if k not in e:
                    errors.append(f"{where}: missing field {k}")
            if e.get("type") not in TYPES:
                errors.append(f"{where}: invalid type {e.get('type')}")
            if e.get("status") not in STATUS:
                errors.append(f"{where}: invalid status {e.get('status')}")
            i = e.get("id")
            if i in seen:
                errors.append(f"{where}: id duplicates {seen[i]}")
            elif i:
                seen[i] = where
            if i and not ID_RE.match(str(i)):
                errors.append(f"{where}: id not kebab-case (must match {ID_RE.pattern})")
            # ── non-fatal warnings ──
            if fdom and e.get("domain") != fdom:
                warnings.append(f"{where}: domain '{e.get('domain')}' != file domain '{fdom}' (may mis-route)")
            if e.get("bundled") is False and e.get("type") in INSTALLABLE and not e.get("install"):
                warnings.append(f"{where}: bundled:false {e.get('type')} has no install command")

    if warnings:
        print(f"⚠️  {len(warnings)} warning(s):")
        print("\n".join("  " + x for x in warnings))
    if errors:
        print(f"❌ {len(errors)} issue(s) ({total} entries total):")
        print("\n".join("  " + x for x in errors))
        sys.exit(1)
    print(f"✅ catalog validation passed: {total} entries, all ids unique.")


if __name__ == "__main__":
    main()
