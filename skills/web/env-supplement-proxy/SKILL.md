---
name: env-supplement-proxy
description: Use an ES6 Proxy recursive wrapper + access logging for "automatic environment supplementation / automatic environment disclosure"—wrap globalThis/window/navigator/document in a recursive Proxy, trap get/set/has/getOwnPropertyDescriptor/deleteProperty, record every "accessed but undefined" path, and pair it with an AI loop (run → catch X is not defined / undefined access → add a stub → rerun → until output stabilizes → diff against a real-browser sample) to semi-automatically supplement the browser environment that anti-scraping/sign obfuscated JS needs when running in headless Node. Covers the core mechanism, the auto-completion loop, and detection/anti-debugging pitfalls (Function.prototype.toString [native code] integrity, toString/valueOf/Symbol.toPrimitive coercion, in/hasOwnProperty, property descriptor getter vs value, navigator/screen/canvas/WebGL/timezone fingerprint consistency, iframe/contentWindow, performance.now/Date timing, UA/platform/webdriver consistency, Proxy leakage via toString/stack), and provides a framework selection table (sdenv / qxVm / NodeSandbox / boda_jsEnv / js-sandbox-env-framework / Browser-Env / node-crawler-env-utils) plus the escape route of upgrading to a real browser. Trigger keywords: environment supplementation, automatic environment supplementation, Proxy environment supplementation, environment disclosure, env completion, window is not defined, navigator is not defined, document is not defined, jsdom, sdenv, browser environment simulation, running encrypted JS headless, proxy hook environment detection, fill whatever is missing, pure-JS environment framework, AI environment supplementation.
languages: [zh, en]
---

# Proxy Automatic Environment Supplementation / Disclosure Skill

> **TL;DR**: Environment supplementation = making a piece of obfuscated JS written for the browser and using `window`/`navigator`/`document` (anti-scraping collection, sign, cookie generation) **run bare in Node** without throwing `X is not defined`.
> **Automatic environment supplementation** = instead of hand-writing every stub, wrap the global objects in a **recursive ES6 Proxy**, trap property access, **record every accessed-but-undefined path**, then run a loop: run → catch what's missing → supply a reasonable value → rerun → until output stabilizes → diff-verify against a real browser. That is what "automatic" and "environment disclosure" mean (the environment itself "discloses" what it is missing).
>
> Honestly, up front: **there is no "one-click supplement any site" silver bullet**. The Proxy/jsdom route has a ceiling—it gets penetrated by `typeof document.all`, V8-level toString/stack detection, and fingerprint consistency checks. This skill teaches **the technique itself + framework selection + when to give up on environment supplementation and switch to a real browser**.

---

## User Trigger Phrases

- "This encrypted JS throws `window is not defined` / `navigator is not defined` as soon as it runs—help me supplement the environment"
- "Build automatic environment supplementation for \<site\>'s collection script, filling whatever is missing"
- "How do I do Proxy environment supplementation / automatic environment disclosure"
- "jsdom can't keep up—is there a pure-JS environment supplementation framework"
- "I'm running this sign algorithm headless in Node—how do I supplement the browser environment"
- "selenium/CDP is too slow; I want to move the algorithm into Node and run it with environment supplementation"

---

## What This Is + When to Use It (Decision First)

When you move a piece of browser JS into Node to run, it immediately hits "the browser global objects don't exist in Node": `window`, `document`, `navigator`, `screen`, `location`, `localStorage`, `XMLHttpRequest`… **Environment supplementation** is "feeding" it those missing things.

**Two supplementation approaches**:
- **Hand-stub**: you add `global.navigator = { userAgent: '...' }` one by one. Precise but extremely slow, and you don't know which properties the script actually queried.
- **Automatic (the Proxy route, this skill)**: wrap the globals in a Proxy, let the script access them itself, and the Proxy **prints out every accessed-but-missing path** for you, so you only supplement what it actually queries. This is the automated version of the `node-bridge-build` principle: "the jni-env-patching 4-step method: look at the real environment first, then give reasonable values, and only supplement what the SDK actually queries."

### When to Choose Proxy Automatic Environment Supplementation (vs Other Routes)

| Your situation | What to choose | Why |
|---|---|---|
| Algorithm isn't complex; you can fully reverse it | **Pure reimplementation** (hand-write a Python/JS reimplementation) | Fastest and most stable, no environment dependency. If you can reimplement it purely, don't supplement the environment |
| Algorithm is too heavy / obfuscation too brutal to reverse, but **QPS demand is high and you need to run it headless at scale** | **Proxy automatic environment supplementation** (this skill) | Don't reverse the algorithm; feed the original JS directly into the semi-automatically supplemented environment and run it—single-process throughput far exceeds a browser |
| The page/App is already running and you only need to call the algorithm occasionally | **`jsrpc-universal`** (JsRpc/Sekiro RPC) | Directly call the function in the real environment, no code extraction and no environment supplementation, but limited by the number of online real endpoints and network RTT, so QPS can't scale up |
| You already have a jsdom template and the target is a known SDK like PX/Akamai | **`node-bridge-build`** (jsdom + 11 env module templates) | Apply the ready-made template directly—faster than building a Proxy from scratch |
| Environment supplementation gets penetrated / fingerprint consistency can't pass, or you just want 100% real | **`cdp-browser`** real Chrome / **`jsrpc-universal`** | A real browser needs no environment supplementation, at the cost of being slow and heavy |

> **One-sentence rule**: when you **must run, headless and at scale in Node, a piece of anti-scraping/sign obfuscated JS you can't reverse**, and a real browser/RPC can't supply enough QPS, and you **don't want to hand-write every stub**—use Proxy automatic environment supplementation.

> Relationship to `node-bridge-build`: that skill is "how to apply a template to build a PX/Akamai bridge when you have a jsdom template"; **this skill is the general technique behind the template**—use it when you have no ready-made template, face an arbitrary site, and want the environment to **semi-automatically disclose itself**. The two can stack: jsdom backstops DOM simulation, Proxy backstops "automatically reporting whatever is missing."

---

## Core Mechanism: Recursive Proxy + Access Log

The "automatic" in environment supplementation relies on a **recursive ES6 Proxy**: wrap the global object, trap all operations, and **recursively wrap the returned object in another layer**, so that no matter how deep a path the script accesses (`window.navigator.connection.rtt`), every layer can be recorded. Key traps:

- `get` — read a property. On a hit for a defined property, return the real value (recursively proxied again); for an **undefined property, record the path and return a "placeholder Proxy"** to avoid an immediate `undefined`/error interruption.
- `set` — write a property. Record what the script stuffs into the environment (often an intermediate value it caches itself).
- `has` — `'x' in window` / `with(window)` scope lookups go through here. **Must return `true`**, otherwise a bare `navigator` written inside a `with` block falls through to the outer scope → `is not defined`.
- `getOwnPropertyDescriptor` — `Object.getOwnPropertyDescriptor` detection goes through here; you must provide a **descriptor consistent with a real browser** (see Gotchas).
- `deleteProperty` / `ownKeys` / `defineProperty` — used when the script enumerates/deletes/redefines properties; anti-scraping commonly uses `Object.keys(navigator)` for comparison.

A minimal but correct "recursive proxy + access log" skeleton:

```javascript
// recursive-env-proxy.js —— Teaching version: once it runs, watch it "disclose" which paths are missing
const missing = new Set();           // Collect "accessed but undefined" paths

function makeProxy(target, path) {
  return new Proxy(target, {
    get(t, prop, recv) {
      // Let Symbol / internal hooks pass straight through, to avoid polluting the log and breaking the Proxy itself
      if (typeof prop === 'symbol') return Reflect.get(t, prop, recv);
      const full = path ? `${path}.${String(prop)}` : String(prop);

      if (prop in t) {
        const val = Reflect.get(t, prop, recv);
        // Only recursively proxy objects/functions; return primitive values directly
        return (val && (typeof val === 'object' || typeof val === 'function'))
          ? makeProxy(val, full) : val;
      }
      // —— Key: if undefined, record it and return a placeholder Proxy that supports continued chained access ——
      missing.add(full);
      return makeProxy(function () {}, full);   // Can both be dotted into as an object and called as a function
    },
    set(t, prop, val) { return Reflect.set(t, prop, val); },
    has(t, prop) { return true; },                       // with(window){...} / 'x' in window won't leak to the outer scope
    getOwnPropertyDescriptor(t, prop) {
      return Reflect.getOwnPropertyDescriptor(t, prop)
          ?? { configurable: true, enumerable: true, value: undefined };
    },
    deleteProperty(t, prop) { return Reflect.deleteProperty(t, prop); },
  });
}

// Start with an empty shell as window, letting the script expose the gaps itself
const fakeWindow = makeProxy({}, '');
globalThis.window = fakeWindow;
globalThis.self = fakeWindow;
globalThis.navigator = fakeWindow.navigator;
globalThis.document  = fakeWindow.document;

// ... require/eval the target obfuscated JS here ...

process.on('exit', () => {
  console.log('=== Accessed-but-undefined paths (stub these) ===');
  console.log([...missing].sort().join('\n'));
});
```

> ⚠️ This teaching version is **only for "disclosing gaps"**; you can't take it straight to defeat anti-scraping: its placeholder Proxy gives itself away the moment it hits `toString()`/`typeof`/descriptor detection. To actually pass detection, follow [`references/proxy-cookbook.md`](references/proxy-cookbook.md) and supplement each detection point correctly.

---

## The Auto-Completion Loop (This Is the "Automatic" Part)

The AI should run environment supplementation as a **convergence loop**, not write it all at once:

```
┌─ 1. Inject the Proxy environment (empty-shell window/navigator/document)
│
├─ 2. Run the target JS
│      ├─ throws "X is not defined"        → global X is missing
│      ├─ throws "Cannot read ... of undefined" → some path broke partway
│      └─ finishes normally but the missing set has entries  → these are paths it queried but had no value for
│
├─ 3. For each gap, supply a [reasonable value] (not an arbitrary one):
│      · String type (userAgent/platform/language)        → copy a real browser's measured value
│      · Function type (addEventListener/getContext)      → give a [native code] shell function returning a reasonable value
│      · Numeric type (screen.width/devicePixelRatio)     → copy a real resolution
│      · Object type                                      → keep letting the Proxy recursively disclose the next layer
│
├─ 4. Rerun → fewer gaps → repeat 2~4
│
├─ 5. Until [output stabilizes]: for two consecutive rounds the missing set stops growing, and the target function produces a result
│
└─ 6. [Verify] diff against a real-browser sample: with the same input, compare the Node output to the real Chrome output
       Match → converged successfully; mismatch → the gap is at the "fingerprint consistency" layer (see Gotchas), not a missing API
```

Value-selection principles for stubs (following `jni-env-patching`'s "read the real environment first, then give reasonable values"):
- **If a value can be captured from a real browser, go capture it** (use `cdp-browser` in real Chrome to read `navigator.xxx`, `screen.xxx`, canvas fingerprints); don't make it up.
- **Made-up values must be internally consistent**: if the UA says Windows, don't make `navigator.platform` be `MacIntel` (see the consistency-check Gotcha).
- **Function stubs return a "harmless value" by default**: event-type ones return `undefined`, query-type ones return an empty array/empty object—first let the script keep running, then refine based on how it later uses the return value.

Mature frameworks (sdenv / the lasawang framework) turn steps 2~3 into a `--detect` automatic-detection mode: one run automatically reports which APIs are missing and gives loading suggestions, so you only need to confirm values. That is "AI-assisted environment supplementation."

---

## ⚠️ Gotchas (the Hardest Part: Anti-Scraping Specifically Detects Environment Supplementation)

When environment supplementation doesn't run, **nine times out of ten it isn't a missing API—it's being detected as "this isn't a real browser."** Work through these one by one:

1. **`Function.prototype.toString` integrity detection (most common)**
   Anti-scraping calls `fn.toString()`; a real native function returns `function xxx() { [native code] }`. Your stub, being a plain JS function, returns the real source code → exposed.
   Solution: the shell function must make `toString` return `function xxx() { [native code] }`, and **`toString` itself must also pass the `toString` check** (a recursive trap). Low-level frameworks (NodeSandbox/node-sandbox's `SetNative`, sdenv's `wrapFunc`) do this at the C++/V8 layer; pure-JS frameworks rely on rewriting `Function.prototype.toString` to intercept. **Note that `Function.prototype.toString.toString()` must also be native.**

2. **`toString` / `valueOf` / `Symbol.toPrimitive` type coercion**
   `'' + navigator` and `navigator + 1` trigger object→primitive conversion. The Proxy's `get` must respond correctly to `Symbol.toPrimitive`, `toString`, and `valueOf`, otherwise it throws `Cannot convert object to primitive value`, or the resulting string leaks `[object Object]` / Proxy traces.

3. **`in` operator + `hasOwnProperty` inconsistency**
   Your `has` returns `true` for everything, but `Object.prototype.hasOwnProperty.call(navigator, 'webdriver')` goes through `getOwnPropertyDescriptor`. The two results don't match (`'x' in obj` is true but you can't get a descriptor) → exposed. `has` and `getOwnPropertyDescriptor` must be coordinated.

4. **Property descriptor mismatch (configurable/enumerable/writable, getter vs value)**
   In a real browser `navigator.userAgent` is a **getter on the prototype** (`get userAgent`), not an own value property on `navigator`; many built-in properties are `enumerable:false`, `configurable:true`. If you directly do `navigator.userAgent = '...'`, it becomes an own value with `enumerable:true` → `Object.getOwnPropertyDescriptor` / `Object.keys` exposes it on comparison. You must define it with a getter at the **corresponding level of the prototype chain**, copying the real browser's descriptor. (NodeSandbox's `defineProperty(mode)` / node-sandbox's `Utils.defineProperty` exist precisely to force-set these bits: `mode=7` = writable/enumerable/configurable all false.)

5. **navigator / screen / canvas / WebGL / timezone fingerprint consistency**
   A single correct value is useless; the **whole group must be consistent**: `userAgent`↔`platform`↔`oscpu`↔`appVersion`, `screen.width/height`↔`availWidth`↔`devicePixelRatio`, canvas/WebGL render result↔`WEBGL_debug_renderer_info` (GPU name)↔UA, `Intl.DateTimeFormat().resolvedOptions().timeZone`↔`Date.getTimezoneOffset()`↔IP geolocation. **canvas/WebGL fingerprints cannot be randomly faked**—either use real captured values (captured by `cdp-browser`) or use a framework's fingerprint profile (the lasawang framework controls the entire fingerprint set from one JSON).

6. **iframe / contentWindow / `document.createElement` trap**
   Anti-scraping often does `document.createElement('iframe')` then grabs `iframe.contentWindow` to get a "clean window" for cross-checking whether you've polluted the prototype, or re-fetches original functions inside the iframe. createElement must return an element shell with the correct prototype per tagName; contentWindow must provide a self-consistent child window (it cannot just return the original window, otherwise `iframe.contentWindow === window` exposes it).

7. **`performance.now` / `Date` timing**
   Behavioral detection computes `performance.now()` deltas and `Date.now()` intervals. In the supplemented environment these values must increase monotonically and be of a reasonable magnitude (don't keep returning the same constant, and don't return Node's real 0.x ms high precision—it differs from the browser's throttled precision). In test mode you can fix the timestamp (qxVm's `isTest`, sdenv's fixed random numbers); in production mode you must give a believable increasing timing sequence.

8. **Environment consistency: UA vs platform vs webdriver**
   `navigator.webdriver` must be `false` (and the descriptor must look native); UA, platform, `navigator.languages`, timezone, `hardwareConcurrency`, and `deviceMemory` must all look like the same real machine. If any one doesn't match, the whole group is blown.

9. **Proxy self-leakage (the nastiest)**
   - `fn.toString()` leaks Proxy/shell code (see #1).
   - When an error is thrown, your `recursive-env-proxy.js` path / `Proxy` frame appears in `error.stack` → anti-scraping's try/catch reading the stack discovers it. The framework must intercept `Error.prepareStackTrace` / `Error.captureStackTrace` and clean out its own frames (NodeSandbox's `stack_intercept`, node-sandbox's `Utils.Error_get_stack`).
   - `typeof proxy` returns `'function'` for a callable Proxy and `'object'` for a plain one, but `document.all` is the **only object in a real browser with `typeof === 'undefined'`**—a pure Proxy can't reproduce this; it requires the V8-layer `setUndetectable` (provided by NodeSandbox/node-sandbox). This is one of the **hard ceilings** of pure-JS environment supplementation.
   - `Object.prototype.toString.call(navigator)` should be `[object Navigator]`; a Proxy-wrapped one may become `[object Object]` → fix it with `Symbol.toStringTag`.

> Treat #1/#5/#9 as the three big killers: toString integrity, fingerprint consistency, Proxy leakage. If these three can't be passed, no amount of additional API supplementation helps.

---

## Framework Selection Table (Honest Tradeoffs)

Item-by-item details in [`references/framework-comparison.md`](references/framework-comparison.md). Quick reference:

| Framework | Route | Good for | Cost / limitation |
|---|---|---|---|
| **pysunday/sdenv** (+ sdenv-jsdom / sdenv-extend) | jsdom fork + plugins + partial C++ | **the public environment-supplementation ceiling**; Ruishu vmp etc.—the author says that with fixed randomness + plugins, the cookie matches the browser | Must compile a node addon (node-gyp + VS/Xcode), picky about Node version; heavy DOM |
| **ylw00/qxVm** | pure JS + vm2, weak references | learning the principles, lightweight, sites with few detection points; `isTest` fixed timing is good for debugging | the open-source version has no dynamic DOM parsing (you rewrite the DOM yourself), limited detection-point coverage |
| **bnmgh1/NodeSandbox** / **node-sandbox** | **modified Node/V8** + wrapping jsdom | when you need V8-layer capabilities (`SetNative`/`setUndetectable`/`defineProperty(mode)`/stack interception) to beat hard detection | open source is an "empty skeleton" with no samples; only a Windows build is compiled; high maintenance cost for a modified node |
| **xuxiaobo-bobo/boda_jsEnv** | env framework | one of the mature domestic env frameworks | the README is almost only a disclaimer; documentation relies on the source/author |
| **lasawang/js-sandbox-env-framework** | **Node VM + Proxy monitoring + fingerprint profile + AI-assisted environment supplementation** | **the closest fit for this skill**: recursive Proxy tracing, `--detect` to auto-report missing APIs, one JSON controlling the entire fingerprint set, webdriver=false/toString protection | the pure-VM route still has a V8-layer ceiling (document.all etc.); the web admin UI is a bonus, not essential |
| **decodecaptcha/Browser-Env** | **proxy to a real browser** (selenium/UC/CDP) + optional jsdom | "no environment supplementation" when supplementation can't pass—execute directly in a real browser | slow, heavy, low QPS; essentially an escape route, not environment supplementation |
| **warterbili/node-crawler-env-utils** | **Proxy environment monitoring tool** (first-party, this repo's owner) | **an "environment disclosure" powerhouse**: `setEnvProxy({paths})` intercepts 12 kinds of Proxy operations, colored logs, deep proxying, call stacks—specifically for running steps 2~3 of the auto-completion loop | it's a "monitoring/gap-disclosure" tool, not a "ready-to-go, detection-passing environment"; must be paired with the finished frameworks above |

**Selection advice**:
- To **learn the technique / watch the Proxy auto-report gaps**: first run the "environment disclosure" loop with the first-party **node-crawler-env-utils**, paired with the **lasawang framework**'s `--detect` + fingerprint profile.
- To **just get the job done against strong adversaries like Ruishu**: go with **sdenv** (accept the compilation cost).
- When you **hit V8-layer hard detection** (`document.all`, toString/stack penetration): go with **NodeSandbox/node-sandbox**'s modified node.

### Escape Route (When You Hit the Ceiling, Don't Force It)

```
Proxy automatic environment supplementation (this skill)
   ↓ fingerprint consistency can't pass / V8-layer document.all / toString·stack penetration
sdenv (jsdom fork, the public ceiling)
   ↓ still penetrated
NodeSandbox / node-sandbox (modified V8, setUndetectable / stack interception)
   ↓ still not worth it (ROI too low)
Real browser: cdp-browser (real Chrome, no environment supplementation)  or  jsrpc-universal (call the algorithm in the real environment)
   or  decodecaptcha/Browser-Env (proxy to a real browser)
```

> Signals that "you should upgrade": you've added 50+ stubs and gaps are still appearing, the diff against a real browser never matches, and the gaps cluster around canvas/WebGL/document.all/stack — **these are the environment-supplementation ceiling, not a sign you haven't supplemented enough**. Switch to a real browser decisively.

---

## Example (Shortest Usable Path)

```bash
mkdir env-supplement && cd env-supplement
npm init -y
# First-party "environment disclosure" monitoring tool (for running the auto-completion loop)
npm install crawler-env-utils
# Add jsdom when you need DOM simulation
npm install jsdom
```

**Step 1: First let the environment "disclose" what's missing** (the teaching Proxy or node-crawler-env-utils)

```javascript
// run-and-collect.js
const { setEnvProxy, LogLevel } = require('crawler-env-utils');
setEnvProxy({
  paths: ['window', 'navigator', 'document', 'screen', 'location'],
  deepProxyPaths: ['window.navigator'],          // recursive deep proxying
  logConfig: { level: LogLevel.TRACE, showStackTrace: true },
});
// require / eval your target obfuscated JS:
const sign = require('./target_obfuscated.js');
try { console.log(sign.getToken('payload')); }
catch (e) { console.log('broke at:', e.message); }   // catch X is not defined / of undefined
```

```bash
node run-and-collect.js
# See which paths were [GET] in the log but had no value → that's the list to supplement
```

**Step 2: Iteratively add stubs (converge around "is not defined")**

```javascript
// env.js —— each round, supplement what the log reports as missing; prefer capturing values from real Chrome (cdp-browser)
globalThis.navigator = Object.create(Navigator?.prototype ?? {});
Object.defineProperty(navigator, 'userAgent', {            // prototype getter + real descriptor
  get() { return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...'; },
  enumerable: false, configurable: true,
});
Object.defineProperty(navigator, 'webdriver', { get(){ return false; }, configurable:true });
// Function stubs must pass [native code] detection:
function native(fn, name) {
  Object.defineProperty(fn, 'name', { value: name });
  fn.toString = () => `function ${name}() { [native code] }`;  // real frameworks do this at the V8 layer; illustrative here
  return fn;
}
globalThis.addEventListener = native(function addEventListener(){}, 'addEventListener');
```

```bash
# Step 3: rerun → fewer gaps → repeat step 2 until stable
node -r ./env.js run-and-collect.js
```

**Step 4: diff-verify against a real browser**

```bash
# With the same payload, run sign in real Chrome (using the cdp-browser skill) and compare outputs
# Match = converged; mismatch with gaps in canvas/WebGL/document.all = hit the ceiling, take the escape route
```

> To actually beat a strong adversary, don't use the teaching `native()` above—its `toString` will give itself away. Use sdenv's `browser(window,'chrome')` to inject in one shot, or NodeSandbox's V8-layer `SetNative`. The teaching version is only for understanding the loop.

---

## What Not to Do

- ❌ **Don't try to mock every browser API** — it's impossible and unnecessary. The Proxy auto-reports gaps; **only supplement what the script actually queries** (the same principle as `node-bridge-build`).
- ❌ **Don't make up fingerprint values** — prefer capturing UA/canvas/resolution from real Chrome with `cdp-browser`; made-up values are inconsistent nine times out of ten.
- ❌ **Don't randomly fake canvas/WebGL** — they can't be random; they must be really captured or use a framework fingerprint profile.
- ❌ **Don't use a plain JS function as a stub and expect to pass detection** — one `toString` check exposes it; you need a `[native code]` shell.
- ❌ **Don't mindlessly recursively proxy everything** — proxying `Function.prototype` / `Object.prototype` / Symbol pollutes and self-harms; ignore `__proto__`/`constructor`/Symbol (node-crawler-env-utils's `ignoredProperties` does exactly this).
- ❌ **Don't hardcode credentials/proxy accounts** — use env vars.
- ❌ **Don't keep brute-forcing after hitting the ceiling** — when the gaps are at document.all/stack/canvas consistency, it's the ceiling, not a skill issue—switch to a real browser.

---

## Companion References

| File | Contents |
|---|---|
| [`references/proxy-cookbook.md`](references/proxy-cookbook.md) | Recursive Proxy code patterns + how to handle each detection point (toString/[native code], Symbol.toPrimitive, has/descriptor coordination, document.all, stack cleanup, Symbol.toStringTag, iframe/contentWindow) + the auto-completion loop scaffold |
| [`references/framework-comparison.md`](references/framework-comparison.md) | Item-by-item comparison of 7 frameworks (route/capabilities/limitations/installation pitfalls) + selection decision tree + the scenario each one fits best |

Related skills: use **`cdp-browser`** to obtain real values; use **`node-bridge-build`** when you have a PX/Akamai jsdom template; use **`jsrpc-universal`** to directly call the real algorithm when you don't want environment supplementation; reuse the value-selection methodology from **`jni-env-patching`** (read the real environment first, then give reasonable values).

---

## ❌ "Natural-Language Traps" to Avoid

1. **"Environment supplementation can one-click handle any site"** — it can't. There's a V8-layer ceiling (document.all/toString/stack).
2. **"Just fill whatever's missing and getting it to run is enough"** — running ≠ passing detection. You must diff-verify against a real browser.
3. **"Just put any fingerprint that runs"** — wrong; the whole group must be consistent, and canvas can't be random.
4. **"Environment supplementation is always more economical than a browser"** — only when QPS is high and the algorithm can't be reversed; for occasional calls, RPC/browser is simpler.
5. **"A Proxy that returns true / a placeholder object for everything is enough"** — if any of has/descriptor/toString/stack is inconsistent, it's exposed.

---

*This skill is compiled from the READMEs/source of pysunday/sdenv(+jsdom/extend), ylw00/qxVm, bnmgh1/NodeSandbox and node-sandbox, xuxiaobo-bobo/boda_jsEnv, lasawang/js-sandbox-env-framework, decodecaptcha/Browser-Env, and warterbili/node-crawler-env-utils; the mechanisms and detection points come from these frameworks' actual implementations, not from memory. For authorized security research / CTF / teaching purposes.*
