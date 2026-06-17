# Playbook: Locating Key SDK Functions (entry / dispatch / utility)

> Given a brand-new PX SDK, **how do you find the location of every key function?**
>
> For locating algorithms (MD5/HMAC/XOR/...) see [`reverse-algorithms.md`](reverse-algorithms.md).
> This playbook covers the **functional functions**: hQ dictionary decode, /ns
> probe, OB dispatch, event construction, fingerprint collection, cookie read/write,
> captcha.js loading, PoW, and WASM.
>
> Estimated time: **30-60 minutes**.

---

## ⚠️ Important: Two Paths, Two SDK Files

PX has **two paths**, and the functions are distributed across **two SDK files** —
always determine which one you are reversing first:

```
┌────────────────────────────────────────┐
│  Transparent Collector path (99% of traffic) │
│  SDK file: main.min.js                  │
│  2 POSTs → get the _px3/_px2 cookie directly │
│  functions: hQ / /ns / OB / mh / Dd / ur/lr  │  ← 1-7 are here
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│  Press-and-hold Bundle path (only after a risk-score trigger) │
│  SDK file: captcha.js (downloaded separately) │
│  4 POSTs + WASM + PoW + mouse press-and-hold challenge │
│  functions: PoW solver / WASM loader    │  ← 8-9 are here
└────────────────────────────────────────┘
```

**To write a generator for the transparent collector path → you only need
main.min.js + functions 1-7. You do not need captcha.js / PoW / WASM at all.**

The press-and-hold challenge is the Bundle path — a separate system covered alone
in §8-9 of this playbook.

---

## Overview: The 9 Categories of Key Functions to Locate

| # | Path | Function semantics | In which file | Cross-version signature | Difficulty |
|---|---|---|---|---|---|
| 1 | Transparent | **hQ dictionary trio** (dictionary + decoder + lookup) | `main.min.js` | base91 alphabet `F@bt` marker | ⭐⭐ |
| 2 | Transparent | **/ns probe** | `main.min.js` | URL literal `tzm.px-cloud.net` | ⭐ |
| 3 | Transparent | **OB dispatcher** | `main.min.js` | centralized `split("\|").shift()` / scattered `.do\|\|.ob` | ⭐⭐⭐ |
| 4 | Transparent | **27 OB handler registry** | `main.min.js` | literal wire bytes `0/l` or `o/I` | ⭐⭐ |
| 5 | Transparent | **Event construction entry (mh)** | `main.min.js` | assembles POST params `"&pc="` `"&payload="` | ⭐⭐⭐ |
| 6 | Transparent | **Fingerprint collection entry (Dd)** | `main.min.js` | consecutive short-name calls `ev(t); nv(t); ...` | ⭐⭐⭐⭐ |
| 7 | Transparent | **Cookie read/write utility (ur/lr)** | `main.min.js` | `document.cookie` literal | ⭐⭐ |
| 8 | **Bundle** | **PoW solver** ⚠️ press-and-hold path only | `captcha.js` | `crypto.subtle.digest("SHA-256")` | ⭐⭐ |
| 9 | **Bundle** | **WASM loader** ⚠️ press-and-hold path only | `captcha.js` | `WebAssembly.instantiate` | ⭐ |

---

## 1. hQ Dictionary Trio

This sits in the first 1-200 lines of the PX SDK. Function: restore obfuscated
strings via a lookup table (see [`reverse-algorithms.md`](reverse-algorithms.md)
algorithm 5 for details).

### How to locate it

```bash
# Method 1: find the base91 alphabet (most stable)
grep -nE "F@bt" sdk.js
# -> should hit exactly 1 line, which is inside the hM decoder function body

# Method 2: find the longest string array (hP)
grep -boE 'hP\s*=\s*\[\s*"[^"]{1,30}"' sdk.js
# -> iFood: hP=["B5e4T4AM&6+r9i}DvsKZ$@v]5]~~sT", ...

# Method 3: find the lookup + cache pattern (hQ)
grep -nE 'void\s+0\s*===.*\?.*=' sdk.js | head -5
# -> the hQ body contains `void 0 === hO[t] ? hO[t] = hM(hP[t]) : hO[t]`
```

### The three components are adjacent

```
hP array (the longest literal array)
   ↓ immediately follows (same var declaration or within a few lines)
hM decoder (contains the F@bt alphabet)
   ↓ immediately follows
hQ lookup + cache
   ↓ immediately follows
array-rotation IIFE (shuffles the hP order at startup)
```

### How to verify

```js
// decode with hM + hP[0]; it should yield a meaningful string
const { hM } = require('./your-extracted-hM');
const hP_0 = "B5e4T4AM&6+r9i}DvsKZ$@v]5]~~sT";  // copied from the SDK
console.log(hM(hP_0));
// expected: a base64 key or a navigator API name (not garbage)
```

### iFood / Grubhub measurements

| | iFood (new) | older versions |
|---|---|---|
| dictionary variable name | `hP` | array returned by `Id()` |
| decoder variable name | `hM` | inlined in `Rd` |
| lookup function | `hQ(N)` | `Rd(N)` or `wd(N)` |
| offset | none | `-= 495` |

**Key**: variable names change across versions, but the **`F@bt` alphabet has not
changed in 3 years**. grep for it and it will always hit.

---

## 2. /ns Probe URL

PX's network fingerprint endpoint — used by some platforms (iFood uses it, Grubhub
does not).

### How to locate it

```bash
grep -boE '"tzm\.px-cloud\.net|"https://tzm\.' sdk.js
# -> "https://tzm.px-cloud.net"

# the full URL is https://tzm.px-cloud.net/ns?c={uuid}
grep -nE 'tzm\.px-cloud\.net|/ns\?c=' sdk.js
```

### Why it is stable

- `tzm.px-cloud.net` is PX's globally shared telemetry host — unchanged across customers and years
- the `/ns?c=<uuid>` path is hard-wired in the SDK and **not subject to obfuscation**

### How to verify

```bash
curl "https://tzm.px-cloud.net/ns?c=$(uuidgen)"
# -> returns a base64 string (e.g. "3rxcTzITchdNlbg…"), which is the /ns sm value
```

### Platform differences

| Platform | Uses /ns? | Field in EV |
|---|---|---|
| iFood | ✅ yes | EV2 contains BzdyfUJXdks= (/ns sm) + DFg5Ekk4PSU= (/ns duration) |
| Grubhub | ❌ no | tzm.px-cloud.net does not grep |

**How to decide**:

```bash
[ "$(grep -c 'tzm.px-cloud.net' sdk.js)" -ge 1 ] && echo "uses /ns" || echo "no /ns"
```

---

## 3. OB Dispatcher (the core response-decoding function)

Unpacks the `ob` field returned by the server and runs the 27 handlers.

### How to locate it (two deployment styles)

#### Style A: centralized dispatch (iFood)

```bash
# find split("|") immediately followed by shift()
grep -boE 'split\("\|"\)[^;]{0,40}shift' sdk.js
# -> 1 hit = the centralized dispatcher (called yU in iFood)
```

The ~50 lines around that hit are the main OB dispatch logic:

```js
// iFood (the yU function equivalent)
function ??(t, n) {
    for (var h = 0; h < t.length; h++) {
        var o = t[h].split("|"),   ← the grep hit
            c = o.shift(),          ← handler wire byte
            a = registry[c];        ← table lookup
        // ... run the handler
    }
}
```

#### Style B: scattered dispatch (Grubhub)

```bash
# Grubhub's split("|") is an indirect call like r(n.y), so the literal does not grep
# instead: find the .do || .ob handling logic
grep -boE '\.do\s*\|\|\s*\.ob|\.ob\)\s*\[' sdk.js
# -> hits the OB entry (Grubhub spreads it across Tf/Sf/wf/Af/Rf)
```

### How to verify

```bash
# run the decoder against a batch of real samples
node ../scripts/decode_response.js "<TAG>" /path/to/response_1.json
# expected output: { "state": { "no": "...", "to": "...", ... }, "segments": [...] }
```

If all the state.* fields are decoded -> the OB dispatcher is correct.

---

## 4. The 27 OB Handler Registry

Centralized deployments have one object whose keys are wire bytes and whose values
are handler functions:

```bash
# iFood style: literal wire-byte registration
grep -boE 'SP\["[0Il1o]{6,10}"\]' sdk.js | head -10
# -> SP["00l00l"]=za, SP["0lllll"]=zj, ...

# or more general (find any object + wire-byte key)
grep -boE '\["?(I|0|o|l|1){6,}"?\]\s*=\s*[a-zA-Z_]+' sdk.js | head -20
```

### Handler shape matching (version-agnostic)

⚠️ **Do not identify handlers by wire byte** (e.g. `0lll0l`) — it may change per
version. **Identify by argument shape**:

| Handler semantics | Argument shape |
|---|---|
| state.no (server timestamp) | 1 arg, `/^1[5-9]\d{11}$/` |
| state.qa (challenge_hash) | 1 arg, `/^[0-9a-f]{64}$/` |
| state.pxsid | 1 arg, UUID |
| **set_cookie** | **4+ args, first arg `/^_?px/i`** |
| state.to (session_token) | 1 arg, `/^[A-Za-z0-9]{16,}$/` |
| state.appId (bundle) | 1 arg, `/^[a-z0-9]{12,30}$/` |
| state.jf (control_flag) | 1 arg, `/^[a-z]{2,4}$/` |

Full table in [`../references/handler-table.md`](../references/handler-table.md).

---

## 5. Event Construction Entry (mh / equivalent)

The core function that builds the POST request — it combines events + state into
the final collector POST.

### How to locate it

```bash
# it must assemble POST params like payload= appId= pc= sid= etc.
grep -nE '"payload="|"&payload=' sdk.js
grep -nE '"&pc=|"&cs=|"&sid=|"&uuid="' sdk.js
grep -nE '"appId="' sdk.js
```

These lines are usually within the same function body (the POST body string
concatenation logic).

### Function signature

```js
// typical mh function body (called mh in iFood)
function ??(events, config) {
    // 1. encrypt events into the payload
    var payload = Jf(events, ...);

    // 2. compute PC
    var pc = jt(serialize(events), salt);

    // 3. compute sid
    var sid = uuid + hh(state.no);

    // 4. assemble the POST body
    var body = "payload=" + encode(payload) +
               "&appId=" + APP_ID +
               "&tag=" + TAG +
               "&ft=" + FT +
               "&pc=" + pc +
               "&sid=" + sid +
               ...;

    // 5. send the HTTPS POST
    fetch(collector_url, { method: 'POST', body: body });
}
```

### How to verify

It is the **call entry point**, so trace upward:

```bash
# find who calls it (mh is usually triggered by setTimeout/setInterval in the SDK)
grep -nE '\bsetTimeout\([a-zA-Z_]+,' sdk.js | head -5
# see which setTimeout's first argument points to mh
```

---

## 6. Fingerprint Collection Entry (Dd / equivalent)

The core function that collects 200+ fields. It calls a series of short-name
sub-functions in sequence, each collecting one group of fields.

### How to locate it

```bash
# consecutive short-name function calls (typically 5-15 in a row)
grep -nE '\b[a-z]{1,3}\(t\);\s*[a-z]{1,3}\(t\);\s*[a-z]{1,3}\(t\)' sdk.js | head -5
```

### Function signature

```js
function Dd(t) {
    ev(t);    // one group of security checks
    nv(t);    // one group of browser properties
    av(t);    // one group of screen properties
    ov(t);    // one group of navigator properties
    iv(t);    // one group of plugins
    cv(t);    // one group of fonts
    $d(t);    // anti-tamper
    // ... and so on
}
```

### How to use it

Once you know where Dd is, **follow its call chain to find the source of each
field** — this is what lets you locate "where the value of field `d['XXX=']` comes
from." See [`locate-field-sources.md`](locate-field-sources.md) for details.

---

## 7. Cookie Read/Write Utility (ur / lr)

PX's own cookie read/write functions (it does not use `document.cookie` directly).

### How to locate them

```bash
# find document.cookie operations
grep -nE 'document\.cookie\s*[=]|document\.cookie\s*\)' sdk.js
```

This usually hits in 2 places:

```js
// ur(name) — read cookie
function ??(t) {
    var ck = document.cookie;
    // ... search the ck string for the name= value
    return value;
}

// lr(name, value, ttl, opts) — write cookie
function ??(t, e, n, r) {
    document.cookie = t + "=" + e + "; expires=" + ...;
}
```

### How to verify

```js
// the SDK's ur('_px3') should read out the current _px3 value
// the SDK's lr('_pxhd', value, ttl) should write the cookie
```

---

---

## ⚠️ §8 and §9 Below Are for the Bundle Path (press-and-hold challenge) Only

If you are reversing the **transparent collector path** (99% of cases), **stop
here**. Everything below is the Bundle (press-and-hold challenge) path, triggered
only after the PX risk score exceeds the threshold. Read it only if you need it.

---

## 8. PoW Solver (Bundle path only, in captcha.js)

Exists only on the Bundle (press-and-hold) path. **Not in main.min.js; not needed
for transparent scenarios.**

### How to locate it

```bash
grep -nE 'crypto\.subtle\.digest\("SHA-256"' captcha.js
grep -nE 'for\s*\([^)]*<<\s*1[56]' captcha.js   # the difficulty-16 loop mask
grep -nE '0xFFFF' captcha.js                      # 16-bit mask
```

### Function signature

```js
// the PoW main function poi() equivalent
function ??(target, suffix, difficulty) {
    for (var i = 0; i < (1 << difficulty); i++) {
        var candidate = suffix + ('0000' + i.toString(16)).slice(-4);
        if (sha256(candidate) === target) return candidate;
    }
}
```

---

## 9. WASM Loader (Bundle path only, in captcha.js)

**There is no WASM in main.min.js; transparent scenarios never need to touch WASM.**

### How to locate it

```bash
grep -nE 'WebAssembly\.instantiate' captcha.js
grep -nE 'Us\(\)\[10\]' captcha.js   # item 10 in the dictionary is the WASM b64
grep -nE '"\\\\x00asm"\|"\\u0000asm"' captcha.js   # WASM magic
```

### Function body signature

```js
const wasmB64 = Us()[10];   // take the WASM base64 from the dictionary
const wasmBin = atob(wasmB64);   // base64 → binary
WebAssembly.instantiate(wasmBin, imports).then(...);
```

---

## One-Liner: Probe All 9 Function Categories at Once

```bash
#!/bin/bash
SDK="path/to/main.min.js"
CAPTCHA="path/to/captcha.js"  # optional

echo "═══ SDK function location probe ═══"
echo ""
echo "[main.min.js]"
echo "  hQ dictionary trio:"
echo "    base91 alphabet F@bt:  $(grep -c F@bt $SDK)"
echo "    hP array:             $(grep -c 'hP\s*=\s*\[' $SDK)"
echo "    void 0 === cache:     $(grep -cE 'void\s+0\s*===' $SDK)"
echo ""
echo "  /ns probe:              $(grep -c 'tzm.px-cloud.net' $SDK)"
echo "  OB centralized dispatch: $(grep -cE 'split\(\"\\|\"\)[^;]{0,40}shift' $SDK)"
echo "  OB scattered dispatch:  $(grep -cE '\.do\s*\|\|\s*\.ob' $SDK)"
echo "  27 handler registry:    $(grep -cE 'SP\[\"[0Il1o]{6,10}\"\]' $SDK)"
echo "  event construction (payload=): $(grep -cE '\"payload=\"|\"&payload=' $SDK)"
echo "  fingerprint (consecutive calls): $(grep -cE '\b[a-z]{1,3}\(t\);\s*[a-z]{1,3}\(t\);' $SDK | head -1)"
echo "  cookie read/write:      $(grep -c 'document.cookie' $SDK)"
echo ""
if [ -f "$CAPTCHA" ]; then
    echo "[captcha.js (Bundle path)]"
    echo "  PoW SHA-256:          $(grep -c 'crypto.subtle.digest..SHA-256' $CAPTCHA)"
    echo "  WASM load:            $(grep -c 'WebAssembly.instantiate' $CAPTCHA)"
fi
```

**Typical output (iFood 2026-05)**:

```
[main.min.js]
  hQ dictionary trio:
    base91 alphabet F@bt:  1
    hP array:             1
    void 0 === cache:     ~5
  /ns probe:              1
  OB centralized dispatch: 1     ← iFood is centralized
  OB scattered dispatch:  0
  27 handler registry:    ~17    ← 17 registered literally, the rest referenced via hQ
  event construction (payload=): 1
  fingerprint (consecutive calls): 1
  cookie read/write:      2      ← one read, one write
```

If every grep passes -> the function layout matches iFood, and you can directly
adapt the iFood generator by just swapping the constants.

---

## Cross-Version Stability Matrix

| Function | iFood vs Grubhub | iFood new vs old | Across years |
|---|---|---|---|
| hQ dictionary | both use it, same alphabet | both use it, same alphabet | ✅ |
| /ns probe | iFood uses it, Grubhub does not | iFood always uses it | ✅ |
| OB dispatch structure | iFood centralized vs Grubhub scattered | stable within a vendor | ✅ |
| 27 handlers | identical | identical | ✅ |
| event construction mh | identical (same POST field set) | identical | ✅ |
| fingerprint collection Dd | field count differs, structure same | field count varies occasionally | ✅ |
| cookie ur/lr | identical (document.cookie API) | identical | ✅ |
| PoW (captcha only) | iFood has triggered it | iFood always has it | ✅ |
| WASM (captcha only) | iFood has triggered it | iFood always has it | ✅ |

---

## Decision Tree: After Getting a New SDK

```
run the full 9-category function probe script
  │
  ├─ all 9 categories hit
  │     → standard PX SDK, you can proceed to build-generator.md
  │
  ├─ /ns probe misses
  │     → Grubhub-like, omit the /ns fields in the generator
  │
  ├─ OB centralized dispatch hits 0 but scattered dispatch hits
  │     → Grubhub-like, OB handling is spread across multiple functions
  │       → decode by shape matching, do not rely on handler names
  │
  ├─ 27 handler registry hits ≪ 17
  │     → this SDK references handlers via hQ too
  │       → dump the hQ dictionary first, then come back to cross-reference
  │
  └─ almost nothing hits
        → not a PX SDK (check Akamai / DataDome instead)
        → or PX shipped a major rewrite (not seen in 3 years)
```

---

## Related Resources

| What you want | Where |
|---|---|
| Algorithm-layer (MD5/HMAC/etc.) reversing | [`reverse-algorithms.md`](reverse-algorithms.md) |
| Constant location | [`locate-all-constants.md`](locate-all-constants.md) |
| **Field value source location** (where each field is computed) | [`locate-field-sources.md`](locate-field-sources.md) |
| Full 27-handler table | [`../references/handler-table.md`](../references/handler-table.md) |
| Full grep pattern index | [`../references/locate-by-pattern.md`](../references/locate-by-pattern.md) |

---

*These 9 function categories + 9 algorithms = a complete SDK function map. For any
new PX SDK, this playbook lets you locate every key position in 30-60 minutes.*
