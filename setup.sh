#!/usr/bin/env bash
# setup.sh — generate .mcp.json from mcp/mcp.template.json, then run doctor (POSIX).
# Substitutes ${PYTHON} and ${TOOLS_ROOT} with this machine's real paths. Idempotent.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── resolve python ──
if [ -n "${PYTHON:-}" ]; then py="$PYTHON"
elif [ -x "$root/.venv/bin/python" ]; then py="$root/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then py="$(command -v python3)"
elif command -v python  >/dev/null 2>&1; then py="$(command -v python)"
else echo "Python not found (see tools/INSTALL.md)"; exit 1; fi

# ── resolve tools root ──
tools_root="${AUTO_REVERSE_TOOLS:-$root/tools/bin}"

tpl="$root/mcp/mcp.template.json"
[ -f "$tpl" ] || { echo "template not found: $tpl"; exit 1; }
target="$root/.mcp.json"
sed -e "s#\${PYTHON}#${py//\\//}#g" -e "s#\${TOOLS_ROOT}#${tools_root//\\//}#g" "$tpl" > "$target"
echo "[setup] wrote $target"
echo "[setup]   PYTHON     = $py"
echo "[setup]   TOOLS_ROOT = $tools_root"

"$py" -c "import json,sys; json.load(open('$target')); print('[setup] .mcp.json is valid JSON')"

if [ "${1:-}" != "--no-doctor" ]; then
  echo "[setup] running doctor.py ..."
  "$py" "$root/tools/doctor.py" --missing || true
fi
echo "[setup] done. Next: 'python tools/fetch.py <id>' to pull a tool on demand."
