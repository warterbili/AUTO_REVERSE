---
name: js-trace-engine
description: Generic dynamic instrumentation / trace engine for heavily-obfuscated anti-bot JavaScript. Takes ANY obfuscated JS, weaves Babel AST probes (function enter/exit, variable assignments, member reads), recursively re-instruments every runtime-generated string (eval / new Function / string setTimeout) so code that only exists after decryption is also traced, runs it bare in a Node harness on top of an env-supplement-proxy environment, and dumps an aggregated execution trace (hot functions, hot variables, dynamic code-gen layers, candidate sign outputs). Ships an L2 anti-detection prelude (clock freeze defeats timing anti-debug; DebuggerStatement stripping; eval/Function toString spoofing). This is the OBSERVATION layer that stacks on top of env-supplement-proxy / node-bridge-build (which make the JS RUN) — it shows HOW the algorithm computes, not just its output. Use when you must understand the internal computation of obfuscated sign/cookie JS, capture runtime-decrypted algorithm code, or produce an execution trace to guide deep deobfuscation. Trigger keywords — js instrumentation, dynamic trace, 插桩, 动态插桩, trace 轨迹, hook eval, recursive eval, 织探针, deobfuscation trace, anti-bot sign trace, JSVMP trace, dump runtime code.
languages: [zh, en]
---

# JS dynamic trace engine

> **TL;DR**: `env-supplement-proxy` / `node-bridge-build` make obfuscated browser JS *run*
> headless in Node and give you the **output** (the sign value). This skill makes the running
> JS **observable** — it weaves probes so you see **how** the value was computed: which
> functions ran, what each variable became, and crucially **the code that only appeared at
> runtime via `eval`/`Function`**. It is the missing observation layer, not another env patcher.

## When to use

- You can already run the target's obfuscated JS in Node (via env-supplement) but you need to
  understand the algorithm, not just call it.
- The real logic is delivered as `eval(decrypt(...))` / `new Function(...)` and you keep losing
  it because it doesn't exist statically.
- You want an execution trace to feed back into deep deobfuscation (the iterate loop).
- You want to defeat `debugger`/timing anti-debug while observing — without single-stepping.

When NOT to use: if you can fully reimplement the algorithm, just do that (see
env-supplement-proxy's decision table). For a JSVMP bytecode VM, see the dispatch-loop note in
`references/adversarial-layer.md` — weaving the whole AST is the wrong move there.

## Pipeline

```
input.js
  ↓  (optional) webcrack static pre-clean            --webcrack
  ↓  L1 Babel instrument (src/instrument.js)
  ↓     function enter/exit · assignments · member reads (--members) · strip debugger
  ↓     + this same instrumenter is the RECURSION primitive for eval/Function
  ↓  L2 prelude (src/prelude.js): __T sink + eval/Function/setTimeout hooks
  ↓     + clock freeze (--freeze-clock) + toString spoof
  ↓  Node harness (src/run-node.js)  [--env <env-supplement module>]
  ↓  aggregate (src/aggregate.js): hot fns · hot vars · dyn code-gen layers · candidate tokens
output: jt-out/{instrumented.js, trace.json, summary.txt}
```

## Quick start

```bash
cd skills/web/js-trace-engine
npm install

# auto-router: fingerprints the target and picks the layer (VM -> L3, else L1+L2)
node cli.js auto ./collector.js --out jt-out --env ../node-bridge-build/<site>/env/index.js --freeze-clock --anti-debug

# force a specific layer:
node cli.js trace   test/sample-eval.js --out test/out --members --freeze-clock  # L1+L2 (recursive eval + anti-debug)
node cli.js vmtrace test/sample-vm.js   --out test/out-vm                          # L3a JSVMP / CFF dispatch-loop trace

# lift: rename obfuscated identifiers from static + RUNTIME-TRACE evidence (humanify, but trace-aware)
node cli.js lift ./collector.js --trace jt-out/trace.json --apply --model none    # heuristic baseline (no API)
node cli.js lift ./collector.js --trace jt-out/trace.json --apply --model claude   # LLM names (ANTHROPIC_API_KEY)

# Mode-C: live SOURCE REPLACEMENT against a real Chrome (--remote-debugging-port=9540)
node cli.js replace --url https://www.zhipin.com/web/geek/job --port 9540 \
     --rules boss --no-inject --match '*static.zhipin.com*.js*'   # pure file replacement, zero injection
node cli.js verify --port 9540 --match zhipin --selector 'a[href*=job_detail]'  # assert the bypass worked

# reqdiff: "browser works, my Python replay returns an error" → byte-diff the two requests, don't theorize
node cli.js reqdiff --port 9540 --match zhipin --url joblist.json --mine mine.json
#   captures the browser's real request (headers + cookies as sent) and flags missing auth headers +
#   cookie VALUE-ENCODING differences (e.g. a token the browser stores URL-encoded but your replay sent raw)
```

Read `jt-out/summary.txt`. **dynamic code-gen layers** = every runtime-decrypted string captured
and re-instrumented (where the algorithm usually hides). **VM opcode histogram** = the bytecode
stream when the target is a JSVMP.

Deeper layers (need a toolchain / device / Chrome):
- **L3b** patched-QuickJS engine trace — `native/quickjs/` (build.sh + opcode-trace patch)
- **L4** Frida native-memory hook — `native/frida/` (trace-native.js + run-frida.py)
- **Mode-A** live CDP injection into real Chrome — `src/cdp-inject.js`

## How it stacks with sibling skills

| Skill | Role | Relation |
|---|---|---|
| `env-supplement-proxy` | make JS run headless (auto-disclose missing env) | **prerequisite** — produces the `--env` module |
| `node-bridge-build` | jsdom + env templates for known SDKs (PX/Akamai) | alternative `--env` source |
| `cdp-browser` | capture real values from real Chrome | use to diff-verify trace findings; future Mode-A injection target |
| `webcrack` (catalog) | static pre-clean / unpack | optional `--webcrack` stage |
| `jsrpc-universal` | call the function in the real env | use when you only need output, not the trace |

## Layers and limits (be honest)

- Ships **L1 (AST probes)** + **L2 (runtime hooks)**. Good for offline understanding and for
  many sign algorithms. See `references/adversarial-layer.md` for the full L1–L4 model.
- **L1 is for the offline harness**, where integrity checks are neutered. Do NOT make L1 your
  live-injection layer against commercial anti-bot — self-defending `toString` checks deadlock
  on reformatted source. Live work belongs at L2/L3.
- **For live anti-debug BYPASS (not tracing), use Mode-C `--rules` + `--no-inject`** — surgical
  source replacement, zero runtime injection. Injection that overrides `Array`/`rAF`/timing/native
  methods breaks SPA frameworks and trips native-tamper detectors; full L1 instrumentation reopens
  the integrity war and bloats big bundles. Rule-packs change only the detector source. **Bypass,
  never flip**: blank a detector function (`fn(){return;`), never invert its gate (`if(false)`) —
  that routes into the punishment branch (memory bomb). See `cases/boss-zhipin-web-antidebug`.
  Always confirm with `cli.js verify` (measured, not assumed).
- **L3 (QuickJS dispatch-loop patch)** for JSVMP bytecode is the planned next module — not yet
  shipped. For VM targets today, use this engine for the outer layers and hand-trace the VM.
- Known eval limit: global `eval` hook runs strings as **indirect** eval (global scope).
- A new VM's first opcode→semantic mapping still needs a human. This accelerates the 20%; it
  does not auto-solve it.

## Files

- `cli.js` — `auto` (router) / `trace` (L1+L2) / `vmtrace` (L3a) / `lift` (LLM rename) commands
- `src/instrument.js` — L1 Babel probe plugin + `instrumentCode()` (also the recursion primitive)
- `src/prelude.js` — L2 `__T` sink + eval/Function/clock hooks + `Function.prototype.toString` redirect
- `src/anti-debug.js` — anti-debug defeat pass (AST): strip debugger/`Function('debugger')`, defang self-defending regex, shrink memory bombs (`new Array(≥1e5)`/`repeat(≥1e4)`), report eject/devtools-probe
- `src/rule-packs.js` — named SOURCE-level neutralization packs (`web-antidebug`, `boss`) for Mode-C; surgical name-stable regex, `--rules` loads a preset/`.json`/`.js`
- `src/cdp-verify.js` — anti-debug bypass VERIFICATION (picks the real page target, asserts no clear-flood / no redirect / not blurred / rendered)
- `src/cdp-reqdiff.js` — **byte-diff the browser's real request vs your replay** (missing auth headers + cookie VALUE-encoding diffs). The "browser works, replay doesn't → diff first, don't theorize" tool. Pure `diffRequests`/`encodingFlags` unit-tested.
- `src/vm-locate.js` / `src/vm-instrument.js` — L3a: find the JSVMP/CFF interpreter + instrument its dispatch point (side-effect guarded)
- `src/lift.js` — LLM-lift: static + runtime-trace evidence → name suggestions → deterministic Babel scope-rename
- `src/run-node.js` — Mode B Node harness (`--env`, `--freeze-clock`, `--members`)
- `src/aggregate.js` — trace → readable summary (shared by all layers)
- `src/cdp-inject.js` — Mode A: live injection (hooks only) into real Chrome over CDP
- `src/cdp-replace.js` — Mode C: live source replacement. Local transform-proxy + REQUEST-stage `continueRequest({url})` redirect (no `fulfillRequest` OOM on big bundles) + `setCacheDisabled` + `--no-inject` pure replacement + `--rules`/`--anti-debug`/`--instrument` composable transforms. Stays armed so SPA re-fetches keep getting patched.
- `native/quickjs/` — L3b: patched-QuickJS opcode trace (build.sh, patch README, converters)
- `native/frida/` — L4: native-memory Interceptor trace (trace-native.js, run-frida.py)
- `references/architecture.md` — the one-kernel / four-layer model + routing + escalation ladder
- `references/adversarial-layer.md` — defeating self-defending / anti-debug while instrumenting
- `test/` — self-tests: `sample-eval.js` (recursive eval), `sample-vm.js` (JSVMP), `sample-cff.js` (control-flow flattening), `sample-packed.js` (Boss-zhipin-style packed-state bit-sliced dispatch), `sample-defense.js` (native-check + return), `sample-obf.js` (lift rename)

## Locator hardening (real-target lessons)

`vm-locate` detects a dispatcher by the signature **"a loop containing a switch/if-chain whose
discriminant — or a var it derives from — is reassigned inside the loop"**, NOT by case-count or
`while(true)`. This was driven by a real target (Boss zhipin's `zpAegis` token VM), whose state is
a *packed integer* `p` bit-sliced into nested discriminants (`31 & p`, `31 & p>>5`) under a
`for(; p !== void 0;)` loop. The state var is resolved via the **loop condition** first
(`p !== void 0` → `p`), so the trace logs the true program counter, not a derived sub-index.
`sample-packed.js` is the regression guard for this shape.
