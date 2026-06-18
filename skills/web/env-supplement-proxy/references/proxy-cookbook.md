# Recursive Proxy Environment Supplementation Cookbook (Code Patterns + Detection-Point Handling)

> Use together with [`../SKILL.md`](../SKILL.md). These are **directly copy-and-adapt code snippets**: the recursive Proxy skeleton, automatic gap disclosure, and how to correctly handle each anti-scraping detection point.
> The pure-JS forms are for teaching/debugging; items marked **[requires V8 layer]** can't be done thoroughly in pure JS and require NodeSandbox/node-sandbox's modified node or sdenv's C++ addon.

---

## 1. Recursive Proxy Skeleton (with Path + Gap Collection)

```javascript
const ACCESS = { missing: new Set(), get: new Set(), set: new Set() };
const IGNORE = new Set(['__proto__', 'constructor', 'prototype']);  // Don't proxy these; it self-harms

function proxify(target, path, opts = {}) {
  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop === 'symbol' || IGNORE.has(prop)) return Reflect.get(t, prop, recv);
      const full = path ? `${path}.${String(prop)}` : String(prop);
      ACCESS.get.add(full);
      if (prop in t || Reflect.getOwnPropertyDescriptor(t, prop)) {
        const v = Reflect.get(t, prop, recv);
        return (v && (typeof v === 'object' || typeof v === 'function')) ? proxify(v, full, opts) : v;
      }
      ACCESS.missing.add(full);
      if (opts.strict) throw new ReferenceError(`${full} is not defined`);  // turn on for precise localization
      return proxify(function stub() {}, full, opts);   // placeholder: can be dotted into, can be called
    },
    set(t, prop, v) { ACCESS.set.add(`${path}.${String(prop)}`); return Reflect.set(t, prop, v); },
    has() { return true; },                              // see §3
    getOwnPropertyDescriptor(t, prop) { return Reflect.getOwnPropertyDescriptor(t, prop); },
    deleteProperty(t, prop) { return Reflect.deleteProperty(t, prop); },
    ownKeys(t) { return Reflect.ownKeys(t); },
    getPrototypeOf(t) { return Reflect.getPrototypeOf(t); },
    apply(t, thisArg, args) { return Reflect.apply(t, thisArg, args); },
    construct(t, args) { return Reflect.construct(t, args); },
  });
}

function dumpMissing() {
  console.log('=== MISSING (supplement these) ===\n' + [...ACCESS.missing].sort().join('\n'));
}
```

> The first-party tool `warterbili/node-crawler-env-utils`'s `setEnvProxy({ paths, deepProxyPaths, ignoredProperties, enableApply, enableConstruct })` already packages all of this (12 traps + colored logs + call stacks + `maxDepth`); in production use it directly for collection, don't reinvent the wheel.

---

## 2. `[native code]` / Function.prototype.toString Integrity —— **Killer #1**

Anti-scraping's `fn.toString()` expects `function name() { [native code] }`. A plain JS function spits out source code.

```javascript
// Pure-JS approximation: rewrite the global toString to return native text on a hit for a shell function
const NATIVE = new WeakSet();
function asNative(fn, name = fn.name, len = fn.length) {
  Object.defineProperty(fn, 'name',   { value: name, configurable: true });
  Object.defineProperty(fn, 'length', { value: len,  configurable: true });
  NATIVE.add(fn);
  return fn;
}
const _toString = Function.prototype.toString;
const patched = function toString() {
  if (NATIVE.has(this)) return `function ${this.name}() { [native code] }`;
  return _toString.call(this);
};
// Key: patched itself must also pass detection (toString.toString() must be native)
NATIVE.add(patched);
Function.prototype.toString = patched;
```

**Pure-JS holes (you must know these)**:
- `Function.prototype.toString === patched` is itself an anomaly signal in some checks (the real native address differs).
- The descriptor from `Object.getOwnPropertyDescriptor(Function.prototype,'toString')` may give it away.
- What you fetch via `iframe.contentWindow.Function.prototype.toString` is the **unmodified original version** → your shell function gives itself away immediately.

**[requires V8 layer] thorough solution**: NodeSandbox's `cbb_wf.myToString` / node-sandbox's `wanfeng.SetNative(fn)`, sdenv's `wrapFunc` —— mark the function as native at the engine layer, so `toString` detection passes naturally, and fetching the original via iframe is also safe.

---

## 3. `has` / `hasOwnProperty` / `in` Coordination —— Don't Let `with` Leak Out, and Don't Contradict Yourself

```javascript
has(t, prop) {
  // with(window){ navigator } and 'x' in window both go through here.
  // Returning true for everything prevents leaking to the outer scope → prevents "navigator is not defined",
  // but it contradicts hasOwnProperty: 'webdriver' in nav is true, yet you can't get an own descriptor.
  if (prop in t) return true;
  // For detection properties that "should not exist", honestly return false (e.g. certain anti-scraping probe properties)
  if (typeof prop === 'string' && /^(webdriver|__nightmare|_phantom|callPhantom)$/.test(prop)) return false;
  return true;  // let the rest pass so the script continues; gaps are recorded by get
}
```

Key point: for a property where `has` returns `true`, if the script then queries it with `Object.getOwnPropertyDescriptor` / `hasOwnProperty`, you must be able to give a **consistent** descriptor (see §4), otherwise "in is true but there's no descriptor" = exposed. For things that genuinely shouldn't exist (webdriver probes), having `has` return false directly is cleanest.

---

## 4. Property Descriptors + getter vs value (Define Fingerprint Values in the Right Place)

In a real browser `navigator.userAgent` is an **accessor (getter) on `Navigator.prototype`**; `navigator` itself has no own property for it; most built-in properties are `enumerable:false, configurable:true`.

```javascript
// ✅ Correct: define on the prototype, use a getter, copy the real descriptor
function defineNav(name, getter) {
  Object.defineProperty(Navigator.prototype, name, {
    get: asNative(getter, `get ${name}`),
    enumerable: false, configurable: true,        // copy the real browser
  });
}
defineNav('userAgent', function () { return UA; });
defineNav('platform',  function () { return 'Win32'; });
defineNav('webdriver', function () { return false; });

// ❌ Wrong: navigator.userAgent = UA
//    → becomes navigator's own value property, enumerable:true
//    → Object.keys(navigator) gains an extra userAgent, and the descriptor is {value,...} instead of {get}
//    → compared against a real browser, it's exposed immediately
```

**[requires V8 layer] force-changing non-configurable bits**: to change a property to `configurable:false` (DONT_DELETE) and other real bits, or to forcibly redefine/delete on a `configurable:false` property, pure JS can't do it → NodeSandbox/node-sandbox's `defineProperty(obj, key, {value, mode})`, where `mode` is a bitmask: `READ_ONLY=1(writable false) | DONT_ENUM=2(enumerable false) | DONT_DELETE=4(configurable false)`; `mode=7` makes all three false, `mode=0` makes all three true.

---

## 5. toString / valueOf / Symbol.toPrimitive Coercion

```javascript
// Make the object behave like a real object under '' + obj / obj + 1 / `${obj}`
Object.defineProperty(navigator, Symbol.toPrimitive, {
  value: asNative(function (hint) {
    if (hint === 'number') return NaN;
    return '[object Navigator]';     // this is exactly what '' + navigator yields in a real browser
  }, '[Symbol.toPrimitive]'),
  configurable: true, enumerable: false,
});
// Object.prototype.toString.call(navigator) → '[object Navigator]'
Object.defineProperty(navigator, Symbol.toStringTag, { value: 'Navigator', configurable: true });
```

The Proxy's `get` must also let `Symbol.toPrimitive` / `Symbol.toStringTag` / `valueOf` / `toString` hit real values, otherwise coercion throws `Cannot convert object to primitive value`.

---

## 6. `document.all` —— a Pure-JS Hard Ceiling **[requires V8 layer]**

`document.all` is the only object in JS history with `typeof === 'undefined'` that is still usable (an HTML-compatibility legacy). Anti-scraping uses `typeof document.all === 'undefined'` to judge a real browser.

```javascript
// Pure JS can't do it (typeof can't be intercepted by a Proxy). You can only approximate:
// document.all itself exists and is indexable, but typeof is still 'object' → precise detection sees through it.

// [requires V8 layer] node-sandbox: new wanfeng.xtd  /  Utils.setUndetectable(obj)
//   → at the engine layer, mark the object type as undefined, so typeof truly returns 'undefined'
```

When you hit `typeof document.all` detection and must pass it → go straight to NodeSandbox/node-sandbox or switch to a real browser; don't burn time on pure JS.

---

## 7. error.stack Cleanup —— Prevent Proxy Path Leakage **[partially requires V8 layer]**

Anti-scraping does `try{...}catch(e){ analyze(e.stack) }`; if your supplemented-environment file path / `Proxy` frame appears in the stack, you're exposed.

```javascript
// Pure JS: use prepareStackTrace to filter out your own frames
const _prep = Error.prepareStackTrace;
Error.prepareStackTrace = function (err, frames) {
  const clean = frames.filter(f => {
    const fn = f.getFileName() || '';
    return !/env-supplement|proxy-cookbook|node_modules[\\/]crawler-env/.test(fn);
  });
  return _prep ? _prep(err, clean) : clean.map(f => '    at ' + f).join('\n');
};
```

Pure JS can only modify `prepareStackTrace` (V8-specific); more covert stack probing (line-number/format fingerprints) requires **[requires V8 layer]** NodeSandbox's `stack_intercept` / node-sandbox's `Utils.Error_get_stack` to intercept at the low level.

---

## 8. iframe / contentWindow / createElement

```javascript
// createElement returns an element shell with the correct prototype per tagName
const _create = document.createElement.bind(document);
document.createElement = asNative(function createElement(tag) {
  const el = _create(tag);
  if (String(tag).toLowerCase() === 'iframe') {
    // contentWindow can't directly === window (anti-scraping compares them); give a self-consistent child environment
    Object.defineProperty(el, 'contentWindow', {
      get: asNative(function () { return makeChildWindow(); }, 'get contentWindow'),
      configurable: true,
    });
  }
  if (String(tag).toLowerCase() === 'canvas') {
    el.getContext = asNative(function getContext(type) { return makeFakeCtx(type); }, 'getContext');
  }
  return el;
}, 'createElement');
```

Note: anti-scraping often uses an iframe to fetch the **original, unpolluted functions** to cross-check whether you've modified the prototype. The child window must carry the same environment you've already supplemented, otherwise `iframe.contentWindow.Function.prototype.toString` gets the original version and immediately blows the shell from §2.

---

## 9. canvas / WebGL / Timing Fingerprint Consistency

```javascript
// canvas: can't be random! Use a real captured value (cdp-browser captures the toDataURL result in real Chrome)
const REAL_CANVAS = '<dataURL captured from real Chrome>';
function makeFakeCtx(type) {
  if (type === '2d') return { /* fillText/measureText... */ toDataURL: () => REAL_CANVAS };
  // WebGL: the render result + WEBGL_debug_renderer_info (GPU name) must be consistent with the UA
  return { getParameter(p) { /* UNMASKED_RENDERER_WEBGL → 'ANGLE (NVIDIA ...)' */ } };
}
// Timing: monotonically increasing, a browser-like magnitude (not Node's 0.x ms high precision)
let _t0 = Date.now();
performance.now = asNative(function now() { return Date.now() - _t0 + Math.random(); }, 'now');
```

In test mode you can fix it (qxVm `isTest` / sdenv fixed random numbers) to make diffing easy; in production mode give believable increasing values. **The whole fingerprint group must be consistent**: UA↔platform↔GPU name↔timezone↔resolution—one wrong and it's all blown. Using the lasawang framework's JSON profile to control the whole set in one shot is the most painless.

---

## 10. Auto-Completion Loop Scaffold (Stringing §1 into a Convergent Flow)

```javascript
// loop.js —— repeatedly run, report gaps, have a human/AI supplement env.js, rerun, until missing stops growing
const { execSync } = require('child_process');
let prev = -1;
for (let round = 1; round <= 20; round++) {
  let out = '';
  try { out = execSync('node -r ./env.js run-and-collect.js', { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const miss = [...out.matchAll(/MISSING[\s\S]*?===\n([\s\S]*)/g)].map(m => m[1]).join('\n');
  const refErr = [...out.matchAll(/(\w[\w.]*) is not defined/g)].map(m => m[1]);
  const n = new Set([...miss.split('\n').filter(Boolean), ...refErr]).size;
  console.log(`round ${round}: missing=${n}`, refErr.length ? `| ReferenceError: ${refErr}` : '');
  if (n === 0) { console.log('✅ converged; go diff-verify against a real browser'); break; }
  if (n === prev) { console.log('⚠️ no longer converging—may have hit the ceiling (canvas/document.all/stack); consider switching to a real browser'); break; }
  prev = n;
  console.log('→ supplement the gaps above into env.js (prefer capturing real values with cdp-browser), then press Enter to continue...');
  // The AI reads refErr/miss here and generates a new env.js patch
}
```

After convergence, you **must** do step 11 verification, otherwise it's only "running" and not "passing detection."

---

## 11. diff-verify Against a Real Browser (Convergence Criterion)

```javascript
// With the same input, run the target function in the Node supplemented environment and in real Chrome (cdp-browser), and compare outputs
// Match           → converged successfully
// Mismatch        → the gap is in fingerprint consistency/timing/canvas, not a missing API; fix per §9 or take the escape route
// Repeated mismatch → hit the ceiling; switch to cdp-browser / jsrpc-universal
```

---

## Quick Reference: Detection Point → Solution → Whether V8 Layer Needed

| Detection point | Pure-JS solution | V8 layer needed? |
|---|---|---|
| `fn.toString()` = `[native code]` | rewrite `Function.prototype.toString` | Yes (for a thorough fix) |
| `'x' in window` / `with` leakage | `has` returns true (probe properties return false) | No |
| descriptor getter vs value / enumerable | `defineProperty` + getter on the prototype | No |
| change the `configurable:false` bit | — | Yes (`defineProperty(mode)`) |
| `'' + obj` coercion | `Symbol.toPrimitive` / `toStringTag` | No |
| `typeof document.all === 'undefined'` | — | Yes (`setUndetectable`/`xtd`) |
| `error.stack` leaking paths | filter with `Error.prepareStackTrace` | Partially |
| `iframe.contentWindow` cross-check | give a self-consistent child window | No |
| canvas/WebGL fingerprint | real captured value (can't be random) | No |
| `navigator.webdriver` | prototype getter returning false | No |
| timing `performance.now` | a monotonically increasing stub | No |
