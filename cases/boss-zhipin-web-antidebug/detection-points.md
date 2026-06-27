# Boss Zhipin Anti-Debug — Detection-Point Inventory & Principles

> Companion to [`case.md`](case.md). Every snippet below is extracted from the real `main.js` (SEO build) and
> `vendor-1.b980027c.js` (SPA build). Minified identifiers are kept verbatim; `L(...)` is the bundle's string
> decoder. **The same logic exists in both bundles** with different minified names but shared class-method names
> (`XCID`/`XCIT`).

## Architecture: defense-in-depth across bundles

The anti-debug is **layered** — no single check is load-bearing; they cross-trigger. Removing one surfaces another.
There are three functional groups:

1. **Detectors** — decide "is DevTools open / is the runtime tampered?" (`Rm`, `XCID`/`XCIT`, `Ef`, timing).
2. **Reactions** — what happens on positive detection (`Bm` eject, `method_modify` report, console flood/clear).
3. **Punishment** — escalation for *tampering* specifically (memory bombs, server-side env flag → redirect).

---

## Layer 1 — `Rm()`: native-method-tamper detector

Checks that the JS runtime primitives are genuine and un-hooked. Returns true only for a pristine browser.

Techniques it combines:
- `x instanceof Location` / `instanceof HTMLDocument` — identity checks a `Proxy`/fake can't pass cleanly.
- `fn.toString()` must contain `[native code]` — catches monkey-patched natives (a hooked fn stringifies to JS source).
- `Object.getOwnPropertyDescriptor` on accessor props — catches redefined getters/setters.
- `toLocaleString` / SEWO (self-evaluating) poison probes — secondary integrity nets.

**Principle:** if you hook a native method (the classic "neuter by override" move), its `toString()` no longer
says `[native code]` → `Rm()` fails → feeds the `Bm` gate → punishment. **This is why runtime injection is the
wrong tool against this target.** File replacement changes nothing about native methods, so `Rm()` stays happy.

---

## Layer 2 — `Bm()`: the eject action (and the memory-bomb trigger)

Real structure from `main.js`:

```js
function Bm(){
  var e,t,
  n = Rm(),                                                       // natives un-hooked?
  i = window[L(Om)] && "[object HTMLDocument]"===document.toString.call(document)
        && window[L(Om)] instanceof HTMLDocument,                 // document genuine?
  a = …body…  instanceof HTMLBodyElement && "[object HTMLBodyElement]"===…,   // body genuine?
  o = …documentElement… instanceof HTMLHtmlElement && "[object HTMLHtmlElement]"===…; // html genuine?
  try{ Date.now()% … }                                            // probability / timing sub-gate
  if (n && i && a && o) { …normal/eject-on-real-devtools… }
  else                  { …report method_modify + detonate memory bomb… }
}
```

`n,i,a,o` all mean **"this primitive is genuine"**. A pristine Chrome → all true → `if` branch → safe.

**Eject payload** (when it does fire): `window.open("","_self")`, `window.close()`, `history.back()`, and an
injected `<style>` applying `filter: blur(20px)` / `display:none` to blank the page, plus a `method_modify` report.

### Why flipping the gate detonates the bomb
Setting `if(n&&i&&a&&o)` → `if(false)` **forces the `else` punishment branch unconditionally**. The `else` is the
path reserved for "environment is fake/hooked" — exactly the bomb. **Flipping a detector's result == self-reporting
as an attacker.** Correct neutering: blank the whole function (`function Bm(){return;`) so neither branch runs —
no eject *and* no punishment.

---

## Layer 3 — Memory bombs (the punishment)

Real call sites from `main.js`:

```js
for(var p=[],u=0;u<100;u++) p.push(new Array(1e4).fill("JBwd…"));   // 100 × 10k DENSE arrays
for(var t=0;t<1e3;t++)      e.push(new Array(1e4).fill("x"));  s.push.apply(s,e);  // 1000×, kept alive in s
window[n]=new Array(1e9);                                           // billion-length (sparse, cheap alone)
…t["nested_"+n]="x".repeat(1e4);  s.push(t), r(e-1);               // big strings + recursion r(e-1)
```

**What actually causes OOM (not "one big array"):**
- `new Array(1e9)` **alone is cheap** — V8 stores it sparse (length metadata only).
- `.fill(...)` **densifies** the array → real contiguous allocation of 10k slots.
- `.repeat(1e4)` allocates a real 10k-char string.
- Loops (×100 / ×1000) multiply the unit cost into thousands of live objects.
- **`s.push(...)` / `window[n]=...` keep strong references → GC cannot reclaim.** (Without retained refs the
  allocations would be collected immediately and memory would never climb — this retention is the real bomb.)
- **Recursion `r(e-1)`** repeats the whole allocation per level → snowballs past the V8 tab heap cap (~2–4 GB) → tab OOM.

**Defusal:** `new Array(1eN)→new Array(1)` and `.repeat(1eN)→.repeat(1)`. Even if some path invokes a bomb fn,
each unit allocation is now 1 element / 1 char → GC keeps up → cannot grow. Defense-in-depth alongside the `Bm` blank.

---

## Layer 4 — `XCID()` / `XCIT()`: DevTools detector + console flood

A class whose instances are pushed to a registry and ticked ~every 500 ms.

- **`XCIT()`** builds the probe: `this.div = document.createElement("div")`, then
  `div.__defineGetter__("id", () => { /* fires only when DevTools inspects the element */ })`.
- **`XCID()`** runs the detection: checks `eruda`/`vConsole`/`devtools.isShow`, then `console.log(theProbe)` — if
  DevTools is open it *renders* the probe, triggering the `id` getter; it also `console.log`s decoy shapes
  (a `<div>`, a `Date`, a `()=>{}`, a 50-element array) → the **visible "flood"** of weird objects in the console.

**Shared-name invariant:** SPA build = `XCID(){…}` (ES6 method shorthand); SEO build =
`key:"XCID",value:function(){…}` (Babel `_createClass`). Same name, two syntaxes → two regex variants cover all bundles.

**Neutering:** make `XCID`/`XCIT` return immediately → no probe build, no detection, no flood. Because the eject is
*downstream* of detection, killing the detector also stops the reaction it would have caused.

---

## Layer 5 — console flood/clear chain (`_f`/`Df`/`If`/`jf`)

```js
var _f, Df, If, Nn = window || global;
function jf(){ If() }                  // jf is called from setInterval(…,500) and from XCID paths
…
If = z.ie
  ? (_f=function(){return pg.log.apply(pg,arguments)},
     Df=function(){return pg.table.apply(pg,arguments)},
     function(){return pg.clear()})    // IE branch → If = wrapper fn
  : (_f=pg.log, Df=pg.table, pg.clear);// non-IE → If = NATIVE console.clear (bare comma-expr tail)
```

`pg` is the console object. `If` is the clear wrapper; `jf()` calls it on a timer → the **"console was cleared"
spam** that defeats log inspection.

**The non-IE trap:** Chrome runs the `else` branch, where `If` is assigned the **native** `pg.clear` as the *bare
tail value* of a comma expression (no `If=` token before it). Pattern-matching `…table,VAR=X.clear` misses it; the
fix needs a dedicated `(.table),X.clear)` pattern. See `patch-set.md` #9.

**Do not over-match `.clear`:** legit business calls exist (`Sign.clear`, `i.clear`, `mapInstance.clear`,
`localStorage`-style `n.clear` in `removeItem`). Patches target only **wrapper-definition shapes**
(`()=>X.clear()`, `function(){return X.clear()}`, the log/table/clear tuple), never bare `X.clear()` statements.

---

## Layer 6 — `Ef`: keyboard-shortcut detector

```js
… (73===t || 74===t) …   // t = keyCode;  73=I, 74=J  → Ctrl/Cmd+Shift+I / +J (open DevTools)
```
Watches `ctrlKey`/`shiftKey` (and `metaKey`/`altKey` for macOS) + keyCode 73/74. Neutered by forcing the keyCode
test to constant false (`(73===t||74===t)` → `(!1)`), so the shortcut never registers as a DevTools open.

---

## Layer 7 — `__defineSetter__` + `Xm<535`: timing detector

A frame/timing probe: measures elapsed time across a `__defineSetter__`-instrumented access; if the gap is small
(`Xm<535`) it concludes no debugger pause occurred, else it flags a breakpoint/slow-frame (DevTools open). Neutered
by short-circuiting the comparison.

---

## Server-side coupling (context)

On positive `method_modify` / env-anomaly reports, the session is flagged server-side; subsequent API calls can
return `code:37` (env anomaly), and a security-check path issues `location.replace("/")` → **redirect to home**.
So the redirect has **two** sources: client-side `Bm` (`history.back`) *and* server-side flagging. Pure file
replacement avoids tripping either, because it neither hooks natives nor lets the detectors report.

---

## Summary table

| Layer | Primitive | Detects / does | Neutering strategy |
|---|---|---|---|
| 1 | `Rm()` | native-method tamper (toString/instanceof) | blank function (`return;`) |
| 2 | `Bm()` | eject + bomb trigger, gated on genuineness | blank function — **never flip the gate** |
| 3 | bombs | `Array.fill`/`repeat` × loop × recursion, GC-retained | `1eN → 1` |
| 4 | `XCID`/`XCIT` | DevTools probe + console flood | return early (both syntaxes) |
| 5 | `_f/Df/If/jf` | console flood + native `clear` on timer | no-op the wrapper defs (3 shapes) |
| 6 | `Ef` | Ctrl/Cmd+Shift+I/J + F12 shortcut | constant-false the keyCode tests (patches #10/#11) |
| 7 | `__defineSetter__`/`Xm<535` | timing/breakpoint probe | short-circuit the `<535` guard to true (patch #12) |

> Layers 6 & 7 are shipped in the `boss` rule-pack (`patch-set.md` #10–#12). They are **shape-based**
> (keyCodes 73/74/123 and the `535` threshold are the invariants) and scoped to the `boss` pack so they
> cannot affect another site's legitimate key handlers. Note: for the case's verified workflow (attach a
> Chrome launched with `--remote-debugging-port`) #10–#12 are *not strictly required* — you never press the
> shortcut, and the timing probe's reactions route into the already-blanked detectors — but they complete
> the bypass so the **patched page also tolerates opening DevTools by keyboard**, not only by external CDP.

**Meta-principle:** *bypass detection, never invert its result.* Inverting a gate routes execution straight into
the punishment branch the detector guards. Blank the detectors, defuse the punishment, and patch the source rather
than the runtime.
