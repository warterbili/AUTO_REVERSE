# Playbook: Reverse Encryption / Encoding Algorithms Out of an Obfuscated SDK

> Given a new PX SDK file, **how do you find** which algorithms it uses (MD5? HMAC? XOR? ml? ...),
> and **how do you verify** that the algorithm you reversed is correct?
>
> This is the **operational-layer methodology** sitting between
> `references/locate-by-pattern.md` (grep-pattern cheat sheet) and
> `references/algorithm-chain.md` (algorithm formulas).
>
> Estimated time: **1-3 hours** (if you've used this method before) / half a day (first time).

---

## Core Mental Model

The obfuscator **cannot change** the algorithm — change it and it breaks. It can only change:

```
Source:    function md5Init()  { var A = 0x67452301, B = 0xefcdab89, ... }
                            ↓ obfuscator
Released:  function iF(t, n)   { var c = 1732584193, a = -271733879, ... }
                            ↓ re-obfuscated
Re-issued: function M(t, e)    { var c = 1732584193, u = -271733879, ... }
```

Changed: function names, parameter names, variable names, line numbers.

**Unchanged**:

- Algorithm constant values (`1732584193`, `-271733879`, …)
- Control-flow structure (`var = ..., for (...) {...}`)
- Parameter count
- Input/output shape

**Conclusion**: all reversing work is built on "the things that don't change."

---

## Three-Tier Algorithm-Location Method

Ordered from highest to lowest precision:

```
High  ⭐⭐⭐⭐⭐  RFC-standard magic constants     MD5 / HMAC / UUID v1
Mid   ⭐⭐⭐⭐    PX self-chosen magic numbers     ml() INT32_MAX, anti-tamper %10+1/+2
Low   ⭐⭐⭐     algorithm control-flow patterns  XOR (charCodeAt^k) / OB split("|")
```

Every SDK lets you grep-hit at least one or two of these, then follow the thread to locate
the surrounding context.

---

## Algorithm 1: MD5 (Standard RFC 1321)

### How to Discover "This Is MD5"

```bash
# Any one of the 4 init constants matching = 100% MD5
grep -n "1732584193" sdk.js    # = 0x67452301 = init A
grep -n "271733878"  sdk.js    # = 0x10325476 = init D
grep -n "-680876936" sdk.js    # = first round 1 constant
```

**Why it's MD5**: these 4 numbers are the RFC 1321 standard init values, present in every
MD5 implementation. Even if PX changes function/variable names, these 4 numbers can't
change — change them and the MD5 output is wrong.

### How to Verify "I Reversed It Correctly"

```bash
# Test: compute md5("test") with the SDK's MD5; it should equal 098f6bcd4621d373cade4e832627b4f6
node -e "
const crypto = require('crypto');
console.log(crypto.createHash('md5').update('test').digest('hex'));
// expected: 098f6bcd4621d373cade4e832627b4f6
"
```

If the output matches → what you located is standard MD5, and you can directly use Node's
built-in `crypto.createHash('md5')` to replace the SDK's obfuscated implementation.

### iFood / Grubhub Field Test (Proof of Cross-Version Stability)

```js
// In iFood (variable names: c, a, u, f)
function iF(t,n) {
    var c = 1732584193, a = -271733879, u = -1732584194, f = 271733878;
    // ... round 1 calls iB(c, a, u, f, ..., 7, -680876936)
}

// In Grubhub (variable names: c, u, s, l)
function M(t,e) {
    var c = 1732584193, u = -271733879, s = -1732584194, l = 271733878;
    // ... round 1 calls C(c, u, s, l, ..., 7, -680876936)
}
```

Variable names changed a/u/f → u/s/l, but **the 4 constant bytes are identical**.

---

## Algorithm 2: HMAC (Standard RFC 2104)

### How to Discover "This Is HMAC"

```bash
grep -n "909522486"  sdk.js    # ipad = 0x36363636
grep -n "1549556828" sdk.js    # opad = 0x5C5C5C5C
```

**Why**: HMAC's ipad and opad are the RFC 2104 standard — present in every HMAC-MD5 /
HMAC-SHA1 implementation.

### Context Structure

```js
// The two matched constants are necessarily on adjacent lines + XOR operations
h[e] = 909522486 ^ r[e],
i[e] = 1549556828 ^ r[e];
```

### How to Verify

```bash
node -e "
const hmac = require('crypto').createHmac('md5', 'salt').update('msg').digest('hex');
console.log(hmac);
// expected to match the SDK's output for the same salt + msg
"
```

---

## Algorithm 3: UUID v1 (Standard RFC 4122)

### How to Discover

```bash
grep -n "122192928e5\|12219292800000" sdk.js
```

**Why**: `12219292800000` = `(1970 - 1582) × 365.25 × 86400 × 1000`. RFC 4122 UUID v1 uses
1582-10-15 as the epoch; converting to the Unix epoch requires this offset. Present in
every v1 implementation.

### Context (iFood / Grubhub Field Test)

```js
// iFood
var p = (1e4 * (268435455 & (f += 122192928e5)) + s) % 4294967296;

// Grubhub (same structure, different variable names)
var d = (1e4 * (268435455 & (l += 122192928e5)) + f) % 4294967296;
```

Accompanying constants:

- `268435455` = `0x0FFFFFFF` (UUID v1 timeLow 28-bit mask)
- `4294967296` = `2^32` (32-bit wrap)

### Verify

```bash
node -e "
const { v1 } = require('uuid');
console.log(v1());
// expected 8-4-4-4-12 format; first digit of the second group is '1' (version 1)
"
```

---

## Algorithm 4: XOR Cipher (No RFC, But Has Control-Flow Signatures)

### How to Discover

```bash
grep -nE "charCodeAt\([^)]+\)\s*\^|\^\s*[a-z]\.charCodeAt" sdk.js
```

This hits **multiple places**:

```js
// Place 1: payload encryption
e += String.fromCharCode(n ^ t.charCodeAt(r))

// Place 2: anti-tamper te()
String.fromCharCode(e ^ t.charCodeAt(r))

// Place 3: OB decode
String.fromCharCode(t.charCodeAt(h) ^ e)
```

### How to Tell These Uses Apart

Look at whether the right side of the XOR is a constant or a variable:

| right side | use |
|---|---|
| `^ 50` or `^ "2"` (ASCII 50) | payload main XOR key |
| `^ 10` | padding XOR key |
| `^ <dynamic variable>` | anti-tamper's te() |
| near `^ 120` or `% 128` | OB response XOR key |

iFood uses `50` as the payload XOR key — run the verification below:

```bash
# Assuming you captured a real payload, check whether reversing with XOR(50) decodes valid JSON
echo "<base64-payload-from-real-capture>" | base64 -d | node -e "
let s = '', t = require('fs').readFileSync(0, 'utf-8');
for (let i = 0; i < t.length; i++)
    s += String.fromCharCode(t.charCodeAt(i) ^ '5'.charCodeAt(0));
console.log(s.slice(0, 100));
"
# If you see [{"t": at the start → XOR key 50 confirmed
```

---

## Algorithm 5: base91 (PX Custom Encoding)

### How to Discover

```bash
grep -c "F@bt" sdk.js
# Should = 1 (matches the start of the base91 alphabet)
```

Full alphabet:

```
F@bt;"m:x3&#LiZ[)TE/}%QD1Iu.6f0R]78|4{zvWC>`$Se(rJ=*c^2_?qOpB,d<AVy~YwoP!+9g5nXhUsNGjaMKHlk
```

**Why it's a base91 marker**: 91 characters (not 64), with a custom-shuffled order. PX
hard-codes it into the hM decoder. Unchanged in 3 years.

### How to Reverse the hM Decoder

Copy the source straight from the SDK (the hM function + the alphabet constant); no need to
rewrite. AI_re already has a Node version:
[`../revers/payload.js`](../revers/payload.js).

Or read it from the SDK yourself:

```bash
grep -A 20 'F@bt' sdk.js | head -25
# Shows the full hM function body (base91 decode logic)
```

### Verify the hM Decoder

```js
// Test decode with a string from the hP[0] dictionary
const { hM } = require('./reverse/payload');
const hP_0 = "B5e4T4AM&6+r9i}DvsKZ$@v]5]~~sT";  // copied from the SDK
console.log(hM(hP_0));
// Should decode to a meaningful string (e.g. a navigator API name / b64 key, etc.)
```

---

## Algorithm 6: ml() Hash (PX Custom, djb2 Variant)

### How to Discover

```bash
grep -nE "31\s*\*\s*[a-z]\s*\+.*charCodeAt" sdk.js
grep -nE "%\s*2147483647" sdk.js
```

Both greps hit the same line:

```js
// iFood
n = (31 * n + t.charCodeAt(e)) % 2147483647

// Grubhub
e = (31 * e + t.charCodeAt(n)) % 2147483647
```

### Why "31 *"

The core of the djb2 hash is `hash * 33 + char`, which can be written as
`hash << 5 + hash + char` or simplified to `31 * hash + char` (off by 2, but essentially
the same). This is the djb2 code signature.

`2147483647` = `INT32_MAX` = `0x7FFFFFFF` — modulo to a 32-bit integer.

### Full ml() Reproduction

```js
function ml(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = (31 * hash + input.charCodeAt(i)) % 2147483647;
    }
    return String(hash % 900 + 100);   // 100-999 string
}
```

### Use

`parseInt(ml(TAG)) % 128` = the OB response XOR key.

### Verify

```js
// Compute ml on the SDK's TAG
console.log(ml('U0MmDhUmOnhXSw=='));   // should output a numeric string between 100-999

// Use this number % 128 as the OB XOR key to decode the response
const xorKey = parseInt(ml('U0MmDhUmOnhXSw=='), 10) % 128;
console.log('OB XOR key:', xorKey);
// For iFood it should be 100
```

---

## Algorithm 7: PC (HMAC-MD5 + Digit Extraction)

### How to Discover

```bash
grep -nE ">=\s*48.*<=\s*57|charCodeAt.*%\s*10" sdk.js
```

Hits the "ASCII range check for digit characters" (48-57 are '0'-'9') + "mod 10".

### Algorithm Structure

```js
function pc(payload, salt) {
    // 1. HMAC-MD5
    const hmacHex = hmacMD5(payload, salt);  // 32 hex chars

    // 2. Character classification
    let digits = '', letters = '';
    for (const c of hmacHex) {
        const code = c.charCodeAt(0);
        if (code >= 48 && code <= 57) {       // '0'-'9'
            digits += c;
        } else {
            letters += (code % 10);            // a-f → ASCII % 10
        }
    }

    // 3. Take even indices
    let pc = '';
    for (let i = 0; i < (digits + letters).length; i += 2) {
        pc += (digits + letters)[i];
    }
    return pc;
}
```

### How to Find the Salt

PC's salt is the concatenation `"uuid:tag:ft"` — this depends on how the SDK assembles the
salt string. grep around the `':'` concatenation code:

```bash
grep -nE 'uuid.*tag.*ft|join\(.:.\)' sdk.js | head -5
```

### Verify

```js
// Given a real captured payload and a known salt, compute PC; it should equal the pc= param in the POST
const realPayload = "...";   // extracted from capture
const expectedPC = "1234567890";  // seen in the POST
console.log(pc(realPayload, `${uuid}:${TAG}:${FT}`) === expectedPC);
// true → both the PC algorithm and the salt are correct
```

---

## Algorithm 8: Anti-Tamper (PX Custom)

### How to Discover

```bash
grep -nE "%\s*10\s*\+\s*[12]" sdk.js
```

Hits `state.no % 10 + 2` and `% 10 + 1` — these are the anti-tamper signature.

### Algorithm

```js
// In the EV2 template, find the field whose key and value both match /^[0-9:;<=>?@]{15,25}$/
// Compute the new key with te(state.to, state.no % 10 + 2)
// Compute the new value with te(state.to, state.no % 10 + 1)
// Replace in place (the key must change too)

function injectAntiTamper(ev2, state) {
    const re = /^[0-9:;<=>?@]{15,25}$/;
    const newKey   = te(state.to, state.no % 10 + 2);
    const newValue = te(state.to, state.no % 10 + 1);
    const out = {};
    for (const [k, v] of Object.entries(ev2)) {
        if (re.test(k) && re.test(v)) {
            out[newKey] = newValue;   // replace key + value in place
        } else {
            out[k] = v;
        }
    }
    return out;
}
```

### Verify

```js
// Compare the real captured EV2 against your computed anti-tamper pair
// state.no, state.to come from the same batch's OB#1 decode; compute te(...)
const computed = te(state.to, state.no % 10 + 2);
const realKey  = Object.keys(realEv2).find(k => /^[0-9:;<=>?@]{15,25}$/.test(k));
console.log(computed === realKey);  // true → computed correctly
```

---

## Algorithm 9: SID Unicode Steganography (Only Some SDKs Have It)

### How to Discover

```bash
grep -nE "917760|0xE0100|fromCodePoint" sdk.js
```

**Match** → this SDK uses SID steganography (iFood does)
**No match** → it doesn't (Grubhub doesn't)

### Algorithm

```js
// SID = uuid + invisible characters (each digit char → U+E0100 + digit, a Unicode Tag)
function sidStego(uuid, payload) {
    let invisible = '';
    for (const ch of String(payload)) {
        invisible += String.fromCodePoint(0xE0100 + ch.charCodeAt(0));
    }
    return uuid + invisible;
}
```

### Verify

```js
// Decode the real captured sid param; check whether the tail is a 0xE0100+ Unicode Tag
const realSid = "abc-123-...<invisible string>";
const tail = realSid.slice(36);  // after the UUID
for (const cp of tail) {
    const code = cp.codePointAt(0);
    console.log(code, String.fromCharCode(code - 0xE0100));
    // output: 0xE0131 -> "1", 0xE0137 -> "7" ...
    // concatenated, should equal some number (XOR key "50" or the cts timestamp)
}
```

---

## Cross-Version Stability Summary

| Algorithm | Cross-version stable signature | How to verify | Difficulty |
|---|---|---|---|
| MD5 | 4 RFC init constants | `md5("test") == 098f6bcd...` | ⭐ |
| HMAC | ipad/opad two RFC constants | matches Node `crypto.createHmac()` | ⭐ |
| UUID v1 | Gregorian offset `122192928e5` | matches npm `uuid` v1 output | ⭐⭐ |
| XOR | `charCodeAt ^ K` control flow | real payload decodes to JSON | ⭐⭐⭐ |
| base91 | alphabet start `F@bt` | hM decodes hP dictionary to meaningful strings | ⭐⭐ |
| ml() | `31 * + charCodeAt + % 2147483647` | OB response decodes to segments | ⭐⭐⭐ |
| PC | `>= 48 .. <= 57` + `% 10` + even-index take | computed PC == pc in POST | ⭐⭐⭐⭐ |
| anti-tamper | `% 10 + 1/+2` | matches the anti-tamper field in real EV2 | ⭐⭐⭐⭐ |
| SID stego | `0xE0100` | decoding the real sid tail yields a meaningful number | ⭐⭐ |

---

## Standard Reversing Flow (New SDK, 30 Minutes)

```bash
SDK="path/to/new_main.min.js"

# Step 1: verify all 5 magic constants (confirm this is a PX SDK)
echo "MD5 init:    $(grep -c 1732584193 $SDK)"
echo "HMAC ipad:   $(grep -c 909522486 $SDK)"
echo "UUID v1:     $(grep -c 122192928e5 $SDK)"
echo "ml() mask:   $(grep -c 2147483647 $SDK)"
echo "base91:      $(grep -c F@bt $SDK)"
# 5/5 = standard PX

# Step 2: directly reuse the 9 algorithm modules in AI_re/reverse
# (because these 5 magic constants present = same algorithms = use existing code directly)
ls revers/
# antitamper.js  hash.js  memory.js  ns.js  ob.js
# payload.js     pc.js    sid.js     uuid.js

# Step 3: field-test verify (run a replay against a batch of real captures)
node ../scripts/decode_payload.js  /path/to/request_1.txt
node ../scripts/decode_response.js "<TAG>" /path/to/response_1.json
# Decodes meaningful JSON / state → the 9 algorithms are 100% generic

# Step 4: compute PC and compare against the pc= in the real POST
node ../scripts/verify_batch.js samples/<site>/1
# If pc PASS → both the PC function and salt algorithm are generic
```

---

## What If an Algorithm Field-Test Isn't Generic?

**Almost never happens** (PX hasn't changed an algorithm in 3 years), but if it does:

| Not generic | Likelihood | Action |
|---|---|---|
| MD5 output wrong | impossible (RFC standard) | you reversed it wrong, go back and check the init constants |
| HMAC output wrong | impossible (RFC standard) | same as above |
| UUID format wrong | extremely low | check the Gregorian offset + 28-bit mask |
| XOR key isn't 50 | medium (PX swaps it occasionally) | try 10 / 100 / 200, etc. |
| ml()'s computed OB XOR key wrong | medium | maybe GT ≠ TAG; find ml()'s actual input |
| PC output wrong | medium (salt concatenation changed) | grep the concatenation code to check the salt format |
| anti-tamper verification fails | high (PX tweaks it occasionally) | check whether +1/+2 became +2/+3 or similar |
| SID wrong | low | check whether the base codePoint is still 0xE0100 |

**Field-test verification beats reasoning**: run a replay with real captures and see which
step is right and which is wrong.

---

## Companion Resources

| What you want | Where |
|---|---|
| Full algorithm formulas | [`../references/algorithm-chain.md`](../references/algorithm-chain.md) |
| Full grep-pattern index | [`../references/locate-by-pattern.md`](../references/locate-by-pattern.md) |
| Runnable Node implementations of the 9 algorithms | [`../../../revers/`](../../../revers/) |
| iFood vs Grubhub algorithm comparison | [algorithm-chain.md](../references/algorithm-chain.md) |
| 19 algorithm-related gotchas | [`../references/gotchas.md`](../references/gotchas.md) |

---

*PX has never changed an algorithm constant in 3 years. Directly reuse the 9 modules in
`reverse/`; onboarding a new SDK only requires updating constants (grep them out) +
templates (capture 6 batches), with the algorithm layer untouched.*
