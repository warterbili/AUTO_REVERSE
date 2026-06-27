#!/usr/bin/env bash
# Build a QuickJS with the opcode-trace patch (L3b). Linux/WSL/macOS only.
# Best-effort auto-patcher; if your quickjs-ng version moved the macro, apply README hunks by hand.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${HERE}/quickjs"

if [ ! -d "${REPO}" ]; then
  git clone --depth 1 https://github.com/quickjs-ng/quickjs "${REPO}"
fi
cd "${REPO}"

QC="quickjs.c"
if grep -q "js_trace_op" "${QC}"; then
  echo "[build] patch already present"
else
  echo "[build] applying opcode-trace patch to ${QC}"
  # Hunk 1: make the switch-dispatch macro wrap our logger under JS_TRACE.
  perl -0pi -e 's/#if !DIRECT_DISPATCH\s*\n#define SWITCH\(pc\)\s+switch \(opcode = \*pc\+\+\)/#if !DIRECT_DISPATCH || defined(JS_TRACE)\n#define SWITCH(pc)      switch (js_trace_op(b, pc, (opcode = *pc++)))/s' "${QC}"

  # Hunk 2: insert the logger just above the JS_CallInternal definition.
  perl -0pi -e 's/(\n[A-Za-z_][A-Za-z0-9_ \*]*JS_CallInternal\()/\n#ifdef JS_TRACE\n#include <stdio.h>\nstatic FILE *js_trace_fp;\nstatic int js_trace_op(JSFunctionBytecode *b, const uint8_t *pc, int opcode) {\n    if (!js_trace_fp) { const char *p = getenv("JS_TRACE_OUT"); js_trace_fp = p ? fopen(p, "w") : stderr; }\n    long off = (long)(pc - 1 - b->byte_code_buf);\n    fprintf(js_trace_fp, "%p %ld %d\\n", (void *)b, off, opcode);\n    return opcode;\n}\n#endif\n$1/s' "${QC}"

  if ! grep -q "js_trace_op" "${QC}"; then
    echo "[build] !! auto-patch did not match this version — apply README.md hunks manually" >&2
    exit 1
  fi
fi

echo "[build] compiling (this can take a minute)"
if [ -f CMakeLists.txt ]; then
  cmake -B build -DCMAKE_C_FLAGS="-DJS_TRACE" >/dev/null
  cmake --build build --target qjs -j >/dev/null
  cp build/qjs "${REPO}/qjs-trace"
else
  make CFLAGS_OPT="-O2 -DJS_TRACE" qjs >/dev/null
  cp qjs "${REPO}/qjs-trace"
fi
echo "[build] done -> ${REPO}/qjs-trace"
echo "[build] run: JS_TRACE_OUT=trace.txt ${REPO}/qjs-trace your-bundle.js"
