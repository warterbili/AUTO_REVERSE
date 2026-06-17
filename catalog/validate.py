#!/usr/bin/env python3
"""
validate.py — verify that catalog/*.yaml entries have complete fields and globally unique ids.
Run after adding an entry: python catalog/validate.py
Requires pyyaml (a dev tool): pip install pyyaml
"""
import glob
import os
import sys

try:
    import yaml
except ImportError:
    print("pyyaml is required: pip install pyyaml")
    sys.exit(2)

REQUIRED = ["id", "name", "type", "domain", "capability", "when_to_use", "source", "bundled", "status"]
TYPES = {"skill", "mcp", "tool", "script", "agent", "platform"}
STATUS = {"active", "slowed", "archived", "commercial"}

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    seen, errors, total = {}, [], 0
    for f in sorted(glob.glob(os.path.join(HERE, "*.yaml"))):
        doc = yaml.safe_load(open(f, encoding="utf-8")) or {}
        for e in doc.get("entries", []):
            total += 1
            where = f"{os.path.basename(f)}:{e.get('id','<no-id>')}"
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

    if errors:
        print(f"❌ {len(errors)} issue(s) ({total} entries total):")
        print("\n".join("  " + x for x in errors))
        sys.exit(1)
    print(f"✅ catalog validation passed: {total} entries, all ids unique.")


if __name__ == "__main__":
    main()
