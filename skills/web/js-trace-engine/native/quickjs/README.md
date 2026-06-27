# L3b — QuickJS opcode-trace patch (offline native dispatch-loop instrumentation)

The strongest layer for **JSVMP run inside a real engine**: instead of locating the obfuscated
JS interpreter (L3a, `vm-locate.js`), you run the target on a **patched QuickJS** whose own
bytecode dispatch loop (`JS_CallInternal`) emits every executed opcode. One patch, full
coverage, at native speed — and it never trips JS-level anti-debug (timing/`toString`), because
the instrumentation lives below JavaScript entirely.

Use this when the target's algorithm runs fine under QuickJS once the environment is supplied
(many sign algorithms do — see the `env-supplement-proxy` skill), and you want a ground-truth
opcode trace of the engine, not a heuristic trace of the obfuscated VM.

> ⚠️ This module is C + a build step. It was **NOT compiled/tested on the authoring machine**
> (Windows, no QuickJS toolchain here). Build it on Linux/mac/WSL. The patch targets
> **quickjs-ng** (`github.com/quickjs-ng/quickjs`); line numbers drift between versions, so the
> patch is given as *find-this / change-to* hunks, not a fragile line diff.

## Why it works

QuickJS interprets bytecode in `JS_CallInternal()` via a dispatch built from macros:

```c
#define SWITCH(pc)   switch (opcode = *pc++)     // (the !DIRECT_DISPATCH form)
#define CASE(op)     case op
```

Every instruction the program runs passes through `opcode = *pc++`. Splice a logger there and
you capture the complete bytecode stream (offset + opcode), the same data L3a recovers — but
authoritative.

## The patch (apply to `quickjs.c`)

### Hunk 1 — force the switch-based dispatch in trace builds (so we can wrap it)

Find the dispatch-selection block (near the top of `JS_CallInternal`, search `DIRECT_DISPATCH`):

```c
#if !DIRECT_DISPATCH
#define SWITCH(pc)      switch (opcode = *pc++)
```

Change the guard so a `JS_TRACE` build always uses the switch form:

```c
#if !DIRECT_DISPATCH || defined(JS_TRACE)
#define SWITCH(pc)      switch (js_trace_op(b, pc, (opcode = *pc++)))
```

(Leave the `#else` computed-goto branch as-is; with `JS_TRACE` we never take it.)

### Hunk 2 — the logger (add just ABOVE `JS_CallInternal`)

```c
#ifdef JS_TRACE
#include <stdio.h>
static FILE *js_trace_fp;
static int js_trace_op(JSFunctionBytecode *b, const uint8_t *pc, int opcode) {
    if (!js_trace_fp) {
        const char *p = getenv("JS_TRACE_OUT");
        js_trace_fp = p ? fopen(p, "w") : stderr;
    }
    /* offset of this opcode within the function's bytecode */
    long off = (long)(pc - 1 - b->byte_code_buf);
    fprintf(js_trace_fp, "%p %ld %d\n", (void *)b, off, opcode);
    return opcode;
}
#endif
```

`b` is the current `JSFunctionBytecode *` in scope inside `JS_CallInternal` (that's why the
logger takes it). The `%p` lets you separate per-function bytecode streams afterward.

## Build (Linux / WSL / macOS)

```bash
./build.sh                       # clones quickjs-ng, applies the hunks, builds qjs-trace
JS_TRACE_OUT=trace.txt ./quickjs/qjs-trace target-bundle.js
node qjs-trace-to-json.js trace.txt > trace.json
node ../../src/aggregate.js trace.json    # same summary view as the JS layers
```

`target-bundle.js` is your obfuscated JS already wrapped with its environment supplement (from
`env-supplement-proxy` / `node-bridge-build`) so it runs headless. The aggregator's
**VM opcode histogram** section then shows the real engine-level opcode stream.

## Mapping opcodes back to meaning

QuickJS opcode numbers are defined in `quickjs-opcode.h` (the `DEF(name, …)` order). Generate a
number→name table once with `make-opcode-table.js` (see file) and the aggregator prints names
instead of raw numbers.

## Honest limits

- Only useful if the target actually runs under QuickJS. Heavy DOM/canvas/WebGL fingerprinting
  may not — then stay at L3a (heuristic JS-level) or go L4 (Frida on the real browser).
- Opcode→algorithm lifting is still yours; this gives ground-truth bytecode, not semantics.
