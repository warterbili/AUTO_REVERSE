# Architecture — one kernel, four injection layers

The kernel is **dynamic instrumentation**: `find a choke point → insert a probe → run → collect`.
"AST", "dispatch loop", and "native memory hook" are not competing kernels — they are the SAME
kernel applied at different layers. You pick the layer by the target; the engine auto-routes when
it can.

```
                                  choke point          mechanism                sees                stealth   module
  L1  source / AST          every syntax node     Babel rewrite            fn/var/value/return     low      src/instrument.js
  L2  runtime / environment eval/Function/clock   wrapper interception     dynamic code, calls     med      src/prelude.js
  L3a interpreter (JS)      the VM dispatch point  Babel wrap of discrim.   opcode/pc stream        high     src/vm-locate.js + vm-instrument.js
  L3b engine (QuickJS)      JS_CallInternal loop   C patch (recompile)      ground-truth opcodes    high     native/quickjs/
  L4  native memory         machine instructions   Frida Interceptor        args/ret below JS       highest  native/frida/
```

The invariant trade: **down = fewer/centraler choke points, higher stealth, but further from
semantics** (L3 shows opcodes, you lift them to "it computed HMAC"). **Up = closer to readable
semantics, but more detectable** (L1 rewrites source → self-defending checks fire). No single best
layer — match it to the target.

## Routing (what `cli.js auto` does)

```
input.js
  └─ vm-locate.js scores functions for "dispatch-loop-ness" (big switch / if-chain + loop)
        ├─ strong VM candidate (score ≥ 8)  → L3a vmtrace  (instrument only the dispatch point)
        └─ otherwise                          → L1 + L2 trace (probes + runtime hooks)
```

Operator escalation beyond the auto-router:
- L3a heuristic missed / too noisy, but the algo runs under QuickJS → **L3b** (ground-truth engine trace).
- Algorithm isn't in JS at all (native `.so` sign) or you need zero JS footprint → **L4** (Frida).
- You need a real fingerprint / real TLS and must not reformat the page → **Mode-A** (`src/cdp-inject.js`).

## Two run modes (orthogonal to the layers)

- **Mode B — offline harness** (`src/run-node.js`): pull the JS out, supply env via
  `env-supplement-proxy`, run it bare in Node with L1+L2 (or L3a). Heavy instrumentation is safe
  here because you control the environment and can neuter integrity checks. Default for understanding.
- **Mode A — live injection** (`src/cdp-inject.js`): inject L2 into a real Chrome before page
  scripts via CDP. Real fingerprints, page never reformatted → source-integrity checks don't fire.
  For capture/verification against the live anti-bot.

## How the four layers share one trace format

Every layer emits the same event shape into `__T` (or, for native, via `send()` / the converters),
so `src/aggregate.js` renders all of them with one view:

| event | from | meaning |
|---|---|---|
| `enter`/`exit`/`ret` | L1, L4 | function boundary + return value |
| `set`/`get` | L1 | variable / member value |
| `dyn` | L2 | a runtime-generated code string (eval/Function/setTimeout/document.write) |
| `vm` | L3a, L3b | one executed opcode (pc, opcode) |

Native layers (L3b, L4) convert into this shape via `native/quickjs/qjs-trace-to-json.js` and
`native/frida/run-frida.py`. So a JSVMP opcode histogram looks identical whether it came from the
JS-level heuristic (L3a) or the patched engine (L3b).

## Status

- L1, L2, L3a, auto-router: implemented and tested in Node (see `test/`).
- L3b (QuickJS C patch), L4 (Frida), Mode-A (CDP): complete modules; require a toolchain / device /
  Chrome to run — not exercised on the authoring machine. See each module's README/header.

## Deliberately NOT solved

A new VM's first opcode→semantic mapping, cross-realm integrity defeat, and OLLVM/VMP-grade native
algos still need a human. This framework removes the mechanical 80% and gives you ground-truth
traces to attack the 20% faster — it does not auto-break adversarial protection.
