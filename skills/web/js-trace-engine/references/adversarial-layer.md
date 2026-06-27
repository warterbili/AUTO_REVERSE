# Adversarial layer: defeating self-defending / anti-debug JS while instrumenting

This is the part that separates a toy tracer from one that survives commercial anti-bot
JS. Researched shapes + concrete defeats. Pair with `SKILL.md`.

## The core rule

**Pick the instrumentation layer the target cannot see.** Four layers, most-detectable first:

| Layer | What you touch | Detectability | Use for |
|---|---|---|---|
| L1 source AST rewrite (Babel probes) | the code's own source | HIGH — breaks integrity/toString | offline harness where checks are neutered |
| L2 runtime intrinsic hooks (eval/Function/clock/toString) | the *environment*, not the code | MED | live capture; the default stealthy layer |
| L3 engine hooks (Frida on V8 / patched QuickJS dispatch loop) | below JS | LOW | VM bytecode trace, full-speed |
| L4 patched engine build | the engine | NONE (to JS) | last resort |

This engine ships L1 + L2. L3 (QuickJS dispatch-loop patch) is the planned next module.

## Self-defending integrity check (the one that punishes naive AST rewrite)

Observed shape (javascript-obfuscator `selfDefending`):

```js
return _0xfn['toString']()['search']('(((.+)+)+)+$')
```

It stringifies a function and runs a regex crafted for **catastrophic backtracking**. When
the source is reformatted/instrumented, the regex engine **hangs** — so naive L1 rewrite
does not merely get "detected", it deadlocks the program.

Defeats, in order of preference:
1. **Don't rewrite live source.** Instrument at L2/L3; leave bytes intact.
2. **Strip the wrapper at AST time.** `selfDefending` emits a known node shape — pattern-match
   the self-referential `toString().search(...)` guard and remove it. Good for obfuscator.io class.
3. **toString redirection.** If you must L1-rewrite, make each instrumented function's
   `.toString()` return its ORIGINAL source (keep an id→original-source map; override
   `Function.prototype.toString` to consult it). Defeats hash/length self-checks too.

## Anti-debug techniques and whether instrumentation passes them

| Technique | Observed shape | Pass? | How |
|---|---|---|---|
| `debugger` statement | `[]['constructor']('debu'+'gger')()` (indirect) or literal | ✅ | strip `DebuggerStatement` at L1 (done in `instrument.js`); the indirect form re-instruments through the Function hook and is stripped there too. And: instrumentation ≠ attaching a debugger, so it never breaks |
| Timing detection | `Date.now()` / `performance.now()` delta to catch single-stepping | ✅ | you run full-speed (no stepping) → never fires; plus `--freeze-clock` returns a monotonic fake clock |
| DevTools detection | console getter side-effects, window dimensions | ✅ | irrelevant headless/Node; stub if needed |
| `toString` native check on your hooks | `eval.toString() === 'function eval() { [native code] }'` | ⚠️ partial | hooks spoof their own `.toString()`; does NOT cover `Function.prototype.toString.call(eval)` |
| Cross-realm integrity | compare against a fresh `<iframe>`'s native `eval`/`Function` | ❌ hard | needs Proxy-based hooks + iframe interception (L2+); case-by-case arms race |

## eval / dynamic code-gen: capture point, not obstacle

Every runtime code-gen vector must be hooked **before any target code runs**, or an early
`var e = eval` alias escapes you:

- `eval`, `(0,eval)`, `window.eval`
- `Function` / `new Function` / `fn.constructor('...')` / `Function.prototype.constructor`
- `setTimeout`/`setInterval` with a string body
- `document.write`, `<script>` injection (browser/L2 with CDP)
- `import()` (dynamic import), `WebAssembly.instantiate` (separate WASM path)

`prelude.js` hooks the first three groups and **recursively re-instruments** each captured
string, so a 5-layer `eval(decrypt(eval(decrypt(...))))` onion is probed at every layer.
Known limit: replacing global `eval` makes calls **indirect** (global scope) — fine for the
common `eval(decrypt(src))` pattern, wrong for eval that reads caller locals.

## VM-based targets (the hard 20%) — instrument the dispatch loop, not the AST

For JSVMP (custom bytecode interpreter; Akamai v3 VM, TikTok VM, ruishu, obfuscator.io VM):

- Do NOT weave the whole AST — you get a flood of "VM read opcode 0x3f", not semantics, and
  you trip integrity checks.
- Locate the interpreter's dispatch site (the `while(1)`/big `switch`, or in QuickJS the
  `JS_CallInternal` loop over `quickjs-opcode.h`) and instrument **that one spot** to log
  `(pc, opcode, operands, stack-effect)`. Lift the resulting bytecode trace to pseudocode.
- This runs at full speed (beats timing anti-debug) and targets loop structure, not the
  per-build-shuffled variable names (beats version drift).

## Steal-from-SOTA notes

- **CASCADE (Google, 2025)** and **JSimplifier (NDSS 2026)** both PUNT on eval/VM/anti-tamper
  — confirming this layer is open frontier, not solved. Borrow CASCADE's *idempotent prelude
  isolation*: detect the string-decode function, run it isolated in a sandbox, fold results
  back as constants — a cheap static assist before tracing.

## References

- Self-defending & debugger traps: https://www.trickster.dev/post/self-defending-js-code-and-debugger-traps/
- Hook eval to deobfuscate (ChiChou): https://gist.github.com/ChiChou/ca9bc84be20106927bd3
- CASCADE: https://arxiv.org/html/2507.17691v1
- JSimplifier / "From Obfuscated to Obvious" (NDSS 2026): https://arxiv.org/abs/2512.14070
- QuickJS bytecode interpreter: https://github.com/bellard/quickjs/blob/master/quickjs-opcode.h
- Aran (heavyweight dynamic analysis framework): https://github.com/lachrist/aran
