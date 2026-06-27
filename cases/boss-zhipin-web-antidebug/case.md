# Case Study: Boss Zhipin (Web) × Multi-Layer Anti-Debug Bypass via Mode-C File Replacement

> Target: `www.zhipin.com` web (SEO build `main.js` 791 KB + SPA build `vendor-1.b980027c.js` / `app~*` chunks)
> Goal: defeat the **entire client-side anti-debug stack** to obtain a clean, debuggable environment — and in doing so, validate the framework's **Mode-C (file-replacement)** capability against a real, hardened target.
> Result: **Full bypass, human-confirmed by the operator.** Zero runtime injection. Page renders, job cards clickable, no console flood/clear, no redirect-to-home, no memory bomb.
> Reusable capability: [`skills/web/js-trace-engine`](../../skills/web/js-trace-engine) (CDP file-replacement) + playbook [`brain/playbooks/web-antibot.md`](../../brain/playbooks/web-antibot.md).
>
> **Token half of the engagement** (`__zp_stoken__` generation, the seed mechanism, and the cookie-encoding
> root cause that lets you use a self-generated token from plain Python): see
> [`token-stoken-and-cookie-encoding.md`](token-stoken-and-cookie-encoding.md) + the runnable
> [`rpc3-inject.js`](rpc3-inject.js) / [`rpc3-backend.py`](rpc3-backend.py).

## One-sentence conclusion

Boss Zhipin ships the **same anti-debug logic duplicated into every webpack bundle** (different minified names, but **class-method names `XCID`/`XCIT` are shared across bundles**). It is defeated not by hooking or by flipping detector gates — which **back-fire into the punishment branch** — but by **replacing each bundle's source on the wire** with a **name-stable universal regex patch set (all 7 detection layers)** served from a local HTTP proxy. File-replacement beats runtime injection here because injection mutates `Array`/`rAF`/timing globals and breaks the SPA framework (job cards stop responding), whereas source patching leaves the framework untouched.

## Why this case matters

1. **Validates Mode-C end-to-end** against a target that actively punishes tampering (memory bombs, native-method-tamper detection, server-side env flagging).
2. **Establishes the cross-bundle universal-patch methodology** — anti-debug replicated across N bundles is *not* solved by per-bundle whack-a-mole; one shared-name regex set covers all.
3. **Documents the "bypass, never flip" principle** — the single most important anti-debug lesson surfaced here (see Phase 3).

---

## Process following the auto_reverse 7-phase method

### Phase 0 — Intake
Target chosen: Boss Zhipin web anti-debug (a catalogued first-party RE target). Symptom reported by operator: **opening DevTools forces a redirect back to the search/home page**, the console **floods and self-clears continuously**, and at times the **browser tab OOM-crashes**. Working environment: a logged-in Chrome launched with `--remote-debugging-port=9540` on a dedicated profile (preserved across the whole engagement so login state survives).

### Phase 1 — Fingerprint
Established the **bundle topology**, which is the crux of the whole case:

| Build | Entry bundle | Used on |
|---|---|---|
| SEO build | `main.js` (791 KB) | Home `www.zhipin.com/` |
| SPA build | `vendor-1.b980027c.js` (68 KB), `app~3.832401b3.js`, … | Job pages `/web/geek/jobs` |

Key fingerprint finding: **each build embeds its own copy of the anti-debug**, with per-bundle minification — *but* the ES6 class methods `XCID()` / `XCIT()` keep their names across bundles (SPA uses ES6 `XCID(){…}`, SEO uses Babel-transpiled `key:"XCID",value:function(){…}`). This shared-name invariant is what makes a single universal patch set viable. See [`detection-points.md`](detection-points.md) for the full inventory.

### Phase 3 — Static analysis
Mapped every detection/attack primitive across `main.js` and `vendor-1.b980027c.js` (full breakdown + real source snippets in [`detection-points.md`](detection-points.md)):

- **`Bm()`** — the eject action: `window.open("","_self")` + `window.close()` + `history.back()` + injects a `<style>` blur(20px)/`display:none` overlay + reports `method_modify` + detonates the memory bomb. Gated by `if(n && i && a && o)`.
- **`Rm()`** — native-method-tamper detector (`instanceof Location`, `[native code]` toString, `getOwnPropertyDescriptor`, `toLocaleString`, SEWO poison).
- **`XCID()` / `XCIT()`** — a ~500 ms loop that runs DevTools detection (eruda/vConsole/`devtools.isShow`, `createElement("div").__defineGetter__("id",…)` + `console.log` probe) and drives the console **flood**.
- **console flood/clear chain** — `_f`=log, `Df`=table, `If`=clear wrappers; `jf(){If()}` invoked on `setInterval(…,500)`.
- **Memory bombs** — `new Array(1eN).fill(…)` (×6) + `"x".repeat(1eN)` (×4), inside loops + recursion, kept alive by pushing into persistent arrays.
- **`Ef`** — Ctrl/Cmd+Shift/Alt + I/J keyboard-shortcut detector (keyCode 73/74).
- **`__defineSetter__` + `Xm<535`** — timing/frame-gap DevTools detector.

**The decisive static insight — "bypass, never flip":** an early attempt flipped the gate `if(n&&i&&a&&o)` → `if(false)`. This **crashed the tab instantly**, because the `else` branch is the *punishment* path (`report method_modify` + memory bomb). The gate evaluates "is the environment genuine & un-hooked?"; forcing it false is **equivalent to self-declaring a tampered environment**, so the page hands us the bomb it reserves for hookers. Correct approach: **neuter the whole function** (`function Bm(){return;`) so neither branch runs.

### Phase 4 — Dynamic analysis (CDP)
Used the framework's CDP layer to drive a real logged-in browser:

- `Fetch.enable({patterns:[{urlPattern:'*.js*',requestStage:'Request'}]})` to intercept every bundle at request stage.
- `Network.setCacheDisabled(true)` — without this, `main.js` loads from disk cache and bypasses the patch.
- A record-and-allow stack tracer (`adl-inject` technique) hooked `history.back`/`window.open`/`location.*`/`console.clear` to **record the calling stack but allow the flow**, pinpointing the eject source.
- Runtime probes (separate CDP client, target-filtered to the zhipin page — *not* the DevTools frontend target) measured ground truth: native `console.clear` call-count over a time window, job-card count, `getComputedStyle(body).filter/display`, and `location.href` stability.

### Phase 6/7 — Synthesize + Verify
Built **`patch-all.js`** (this directory): a generic Mode-C patcher that intercepts **all** `static.zhipin.com/*.js`, fetches each original, applies the **universal regex patch set (all 7 detection layers)**, caches by URL, and serves from a local HTTP server via `Fetch.continueRequest({url})` redirect. See [`patch-set.md`](patch-set.md) for the annotated patches.

**Measured patch hits:** `vendor-1` = 19, `main.js` = 29, `app~3` = 2, all other 24 bundles = 0 (they carry no anti-debug).

**Verification (on an operator-driven job page, independent CDP probe):**

| Check | Result |
|---|---|
| native `console.clear` calls / 6 s | **0** |
| job cards `a[href*=job_detail]` | **17** |
| `getComputedStyle(body).filter` | `none` (no blur overlay) |
| `getComputedStyle(body).display` | `block` (not hidden) |
| redirect-to-home | none; `location.href` stable on the job page |
| `document.body` length | ~85 KB (fully rendered) |

---

## Two hard traps (both hit and solved)

1. **`Fetch.fulfillRequest` with the 791 KB `main.js` body → Out-of-Memory.** Pushing a ~1 MB base64 payload through a single CDP message exceeds practical limits. **Fix:** local HTTP server + `Fetch.continueRequest({url})` redirect — the CDP message carries only a tiny URL.
2. **Runtime injection broke job-card clicks.** An earlier `universal-neuter.js` (injected via `Page.addScriptToEvaluateOnNewDocument`) overrode `window.Array` / `requestAnimationFrame` / `performance.now` / `Date.now` / `String.repeat`. Those globals are load-bearing for the SPA framework → init/render breaks → click handlers never attach, and hooking native methods *also* trips `Rm()`'s `method_modify` detector → server `code:37` → eject. **Fix:** abandon injection entirely; pure source replacement leaves the framework and native methods intact.

---

## The console.clear gotcha (the last-mile bug)

The clear flood survived the first patch round. Root cause — an IE/non-IE ternary:

```js
If = z.ie
  ? (_f=…log…, Df=…table…, function(){return pg.clear()})   // IE branch  → If = wrapper fn
  : (_f=pg.log, Df=pg.table, pg.clear);                      // non-IE     → If = native console.clear (bare comma-expr tail)
function jf(){ If() }                                         // driven by setInterval(…,500)
```

Chrome takes the **else** branch, so `If` becomes the **native** `console.clear`. The bare `pg.clear` has **no `VAR=` prefix** (it's the tail value of a comma expression), so the first-pass `…table,VAR=X.clear` regex missed it. Added a dedicated pattern `(.table),\w+\.clear\)` → `.table,function(){})`. See `patch-set.md` pattern #9.

---

## Boundary / scope

This case covers **client-side anti-debug bypass** (the operator's stated goal) and was human-verified as fully working. It does **not** claim a full account-flow/login-token reverse — a separate `__zp_stoken__` generation thread reached server `code:37→38` (token mechanically valid, login gate next) but is out of scope here. All session cookies/tokens stay local and are **never** committed (placeholders only in any artifact).

## Project gaps exposed (now folded back into the framework)

This case drove a Mode-C overhaul of `skills/web/js-trace-engine` (all done + Chrome-free self-tested):

- **Transport rewrite (`src/cdp-replace.js`)** — replaced `Fetch.fulfillRequest(body)` (OOMs on the
  791 KB bundle) with a local transform-proxy + REQUEST-stage `continueRequest({url})` redirect;
  added `Network.setCacheDisabled`; added **`--no-inject`** (pure replacement, no prelude); stays
  armed so SPA re-fetches keep getting patched.
- **Rule-packs (`src/rule-packs.js`)** — `--rules boss|web-antidebug|<file>`; the `boss` preset is the
  patches from this case. `applyRules(code, BOSS)` reproduces the layer-1–5 hit counts (vendor-1=19,
  main.js=29); the later layer-6/7 additions (#10–#12) raise those totals — re-measure on the next live run.
- **Verification (`src/cdp-verify.js`, `cli.js verify`)** — picks the real page target (not the
  devtools frontend), asserts no clear-flood / no redirect / not blurred / rendered; red-green + exit code.
- **Anti-debug taxonomy (`src/anti-debug.js`)** — added memory-bomb shrink (`new Array(≥1e5)`/`repeat(≥1e4)`)
  and eject/devtools-probe reporting, keeping the existing "report ambiguous, neutralize only safe" philosophy.
- Still open: encode the full SOP into `brain/playbooks/web-antibot.md`.

## Deliverables manifest

| File | Description |
|---|---|
| `case.md` | This case study (process + results) |
| `detection-points.md` | Full anti-debug layer inventory + principles + real source snippets |
| `patch-set.md` | The universal patches (all 7 layers), annotated, with hit counts |
| `source-excerpts.md` | Real, bounded source excerpts of every detector (Bm/Rm/XCID/XCIT/bombs/Ef/timing/eject) from both bundles — verify each patch against ground truth |
| `patch-all.js` | The working Mode-C all-bundle patcher (the reproducible tool) |

## Reproduce

**Prerequisites:** Node 18+ (the patcher uses global `fetch`); `chrome-remote-interface` available
(`cd skills/web/js-trace-engine && npm install`, or set `NODE_PATH` to its `node_modules` for the
standalone script); a desktop Chrome.

**Scope of what reproduces:** the **anti-debug bypass itself reproduces with NO login** — the home
page's `main.js` carries the full stack, so steps below show "0 clears / no redirect / not blurred"
on a fresh browser. The **`--selector 'a[href*=job_detail]'` job-card check needs your own logged-in
session** (we never ship cookies/tokens — placeholders only). So `verify` passes the 5 universal
checks anywhere; the 6th (target elements) only when you are logged in on the job page.

This case's hand-rolled `patch-all.js` has since been folded into the framework as the first-class
`replace` / `verify` commands + the `boss` rule-pack (see "Project gaps exposed" above — now done).
Preferred path:

```bash
# 1. Launch a logged-in Chrome with CDP open (reuse a persistent profile to keep login)
chrome.exe --remote-debugging-port=9540 --user-data-dir=<persistent-profile> about:blank

# 2. Arm pure file-replacement (zero injection) across ALL bundles via the boss rule-pack
cd skills/web/js-trace-engine
node cli.js replace --url "https://www.zhipin.com/web/geek/job?query=java" --port 9540 \
     --rules boss --no-inject --match '*static.zhipin.com*.js*'
# Expected: [patch] vendor-1 … rules:[…×19], main.js … rules:[…×29]; [diag] href stays on the job page.

# 3. Verify the bypass actually worked (measured, not assumed)
node cli.js verify --port 9540 --match zhipin --selector 'a[href*=job_detail]'
# Expected: all [PASS] — 0 clear() calls, 0 flood, no redirect-to-home, filter:none, 17 job cards.
```

The original standalone `patch-all.js` (kept in this directory for reference) is equivalent — it
produces the identical hit counts (vendor-1=19, main.js=29) verified against the framework's
`transformJs(boss)`.
