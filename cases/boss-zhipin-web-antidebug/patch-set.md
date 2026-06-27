# The Universal Patches (Mode-C source replacement)

> Companion to [`case.md`](case.md) / [`detection-points.md`](detection-points.md). These are the exact regex rules
> in [`patch-all.js`](patch-all.js) and in the framework's `boss` rule-pack (`skills/web/js-trace-engine/src/rule-packs.js`).
> They are **name-stable** (rely on shared class-method names `XCID`/`XCIT` and structural shapes — keyCodes, the
> `535` timing threshold, the `.table,…clear` tuple — not per-bundle minified identifiers), so one set covers every
> bundle. Each `*.js` from `static.zhipin.com` is fetched, run through these, cached by URL, and served from a local
> HTTP proxy. The set now covers **all 7 detection layers** (#1–#9 = layers 1–5; #10–#12 = layers 6–7).

```js
const PATCHES = [
  // ── Layer 4: detector + console flood (both syntaxes, cross-bundle) ──
  [/key:"XCID",value:function\(\)\{/g, 'key:"XCID",value:function(){return;'], // #1 transpiled (main.js)
  [/key:"XCIT",value:function\(\)\{/g, 'key:"XCIT",value:function(){return;'], // #2
  [/\bXCID\(\)\{/g, 'XCID(){return;'],   // #3 ES6 class method (vendor-*)
  [/\bXCIT\(\)\{/g, 'XCIT(){return;'],   // #4

  // ── Layer 1+2: native-tamper detector & eject/bomb trigger (main.js) ──
  [/function Bm\(\)\{/g, 'function Bm(){return;'], // #5 eject — blank whole fn, NEVER flip the gate
  [/function Rm\(\)\{/g, 'function Rm(){return;'], // #6 native-tamper detector

  // ── Layer 3: memory bombs (all bundles) ──
  [/new Array\(1e\d+\)/g, 'new Array(1)'], // #7  densify-bomb defused (Array.fill unit → 1)
  [/\.repeat\(1e\d+\)/g, '.repeat(1)'],    // #8  string-bomb defused (repeat unit → 1)

  // ── Layer 5: console.clear wrappers (3 shapes; never touch legit X.clear()) ──
  [/\(\)=>\w+\.clear\(\)/g, '()=>{}'],                        // #9a arrow:   a=()=>t.clear()        (vendor-1)
  [/function\(\)\{return \w+\.clear\(\)\}/g, 'function(){}'], // #9b IE fn:    function(){return pg.clear()}
  [/(\.table,\w+=)\w+\.clear\b/g, '$1function(){}'],          // #9c else:     …table,a=t.clear        (vendor-1)
  [/(\.table),\w+\.clear\)/g, '$1,function(){})'],            // #9d comma-tail:…,Df=pg.table,pg.clear) (main.js)

  // ── Layer 6: Ef keyboard-shortcut detector (const-false the keyCode tests) ──
  [/\(73===\w+\|\|74===\w+\)/g, '(!1)'],   // #10 Ctrl/Cmd+Shift+I/J → handler stops preventDefault-ing
  [/\b123===\w+/g, '!1'],                  // #11 F12 (keyCode 123)

  // ── Layer 7: timing / frame-gap detector (short-circuit the guard) ──
  [/\w+&&\w+<535/g, '!0'],                 // #12 __defineSetter__ probe gated on `Xm<535` → const-true (probe never re-arms)
];
```

## Measured hit counts

> The counts below were measured on the full live bundles with the **layer 1–5 set (#1–#9)** only.
> Patches #10–#12 (layers 6–7) were added afterward and increase the per-bundle totals — `main.js`
> carries `Ef` (Ctrl+Shift+I/J + F12) and the `<535` timing probe, so it gains several hits; the SPA
> bundles gain hits only where they embed those layers. **Re-measure on the next live run** (the
> exact full-bundle deltas were not captured at write time). On the bounded `source-excerpts.md`,
> #10–#12 add **6** hits (4× I/J, 1× F12, 1× `<535`).

| Bundle | Patches applied (layers 1–5) | Notes |
|---|---|---|
| `vendor-1.b980027c.js` | **19** | SPA anti-debug: XCID/XCIT (ES6) + bombs + clear (arrow + else) |
| `main.js` | **29** | SEO anti-debug: XCID/XCIT (transpiled) + Bm/Rm + bombs + clear (IE fn + comma-tail) |
| `app~3.832401b3.js` | **2** | bombs only |
| other 24 bundles | **0** | jquery/vue/bossui/vendor-0..10/app~0,2/login/ka — no anti-debug |

## Notes on correctness

- **#5 (`Bm`) — blank, do not flip.** Flipping `if(n&&i&&a&&o)` → `if(false)` routes into the `else` punishment
  branch (report + bomb) and crashes the tab. See `detection-points.md` Layer 2.
- **#9d is the easy-to-miss one.** In Chrome (`z.ie=false`) `If` is assigned the **bare** `pg.clear` as the tail of a
  comma expression — no `VAR=` prefix — so #9c (which anchors on `VAR=`) does not match it. #9d anchors on the
  `.table),…clear)` shape instead. Without #9d the "console was cleared" spam persists from `main.js`.
- **clear patches are surgical.** They only match wrapper *definitions*; legit `Sign.clear()` / `i.clear()` /
  `mapInstance.clear()` / `removeItem`→`n.clear()` business calls are left intact.
- **Bombs use `\d+` after `1e`** so `1e4`, `1e9`, etc. are all covered in one rule.
- **#10–#12 are shape-based, not name-based, and scoped to the `boss` pack.** The invariants are the
  DevTools keyCodes (73/74 = I/J, 123 = F12) and the `535` timing threshold; `\w+` absorbs the minified
  keyCode/elapsed vars. They are kept in `boss` (not the generic `web-antidebug` pack) so they cannot
  clobber a *different* site's legitimate I/J/F12 key handlers. #10 turns each shortcut branch
  (`…&&(73===t||74===t)`) const-false so `Ef`'s handler stops calling `preventDefault` — the keyboard
  shortcut works again; #12 short-circuits `Xm&&Xm<535` to `!0` so the `||(...)` probe-rearm branch
  never runs. Both were verified to fire on `source-excerpts.md` with zero residual matches.

## Mechanism (why local-server redirect, not fulfillRequest)

```
browser requests *.js
  → CDP Fetch.requestPaused (requestStage:'Request')
  → if static.zhipin.com/*.js : Fetch.continueRequest({ url:'http://127.0.0.1:8099/?u=<origUrl>' })
  → local server: fetch(origUrl) → apply PATCHES → cache by URL → serve (CORS, no-store)
  → else: Fetch.continueRequest()  // pass through untouched
```

- `Fetch.fulfillRequest` with the 791 KB body OOMs CDP → use a redirect carrying only a small URL.
- `Network.setCacheDisabled(true)` is mandatory, else `main.js` serves from disk cache and bypasses the patch.
- **No `Page.addScriptToEvaluateOnNewDocument` injection** — that path (overriding `Array`/`rAF`/timing) breaks the
  SPA framework and trips `Rm()`. Source replacement only.
