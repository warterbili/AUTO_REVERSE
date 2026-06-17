# Relocating every algorithm / function / field in any SDK version

> ⚠️ **Line numbers are untrustworthy** — every time PX ships a new SDK build, all line numbers shift.
> This document **lists only grep patterns / signature constants / function shapes**, which are stable across versions.
>
> Combining this document's grep output with the formulas in `references/algorithm-chain.md`,
> you can relocate all key code on any new SDK build within 30 minutes.

---

## 0. Foundational principles

**Search-target priority (by resistance to obfuscation)**:

| Priority | Type | Why it is stable | Example |
|---|---|---|---|
| ⭐⭐⭐ | **Algorithm magic constants** | Must keep their original values to compute correct results | `1732584193` (MD5 init), `122192928e5` (UUID v1) |
| ⭐⭐⭐ | **Protocol strings** | Required by the server's protocol | `"~~~~"`, `"/api/v2/collector"`, `"x-www-form-urlencoded"` |
| ⭐⭐⭐ | **Browser API names** | The real name is required to call the API | `navigator.platform`, `performance.now` |
| ⭐⭐ | **Base64 strings** | Not fully re-shuffled in the short term | `"U0MmDhUmOnhXSw=="` (TAG) |
| ⭐ | **Code structure shape** | The obfuscator usually does not change control flow | `split("\|").shift()` |
| ✗ | Variable/function names | Change entirely on every obfuscation pass | `hQ`, `jt`, `Dd` are unreliable |
| ✗ | Line numbers | Shift on every release | "Line 775" is unreliable |

---

## 1. Locating cryptographic primitives

### 1.1 MD5 — search for the init constant

```bash
grep -nE "1732584193" main.js
# Matching line format: var ... = 1732584193, ... = -271733879, ... = -1732584194, ... = 271733878
```

**Why it is stable**: These 4 numbers are MD5's RFC 1321 standard init values (A/B/C/D); every MD5 implementation has them.

### 1.2 HMAC — search for ipad/opad

```bash
grep -nE "909522486" main.js     # ipad: 0x36363636
grep -nE "1549556828" main.js    # opad: 0x5C5C5C5C
```

**Why it is stable**: HMAC RFC 2104 standard pad masks.

### 1.3 XOR cipher — search for charCodeAt + ^

```bash
grep -nE "charCodeAt\([^)]+\)\s*\^|\^\s*[a-z]\.charCodeAt" main.js
```

This hits several places. Read the context:
- `^ 50` → payload XOR key
- `^ 10` → padding key XOR
- `^ <dynamic>` → anti-tamper te()

### 1.4 base64 UTF-8 encoding — search for the "0x" + n pattern

```bash
grep -nE 'String\.fromCharCode\("0x"\s*\+' main.js
# Or search the pattern: encodeURIComponent + replace(%XX → fromCharCode)
grep -nE 'encodeURIComponent.*replace.*%' main.js
```

**Why it is stable**: PX's `z()` function always uses the fixed pattern `btoa(encodeURIComponent(t).replace(/%([0-9A-F]{2})/g, ...))` to do UTF-8 base64.

### 1.5 UUID v1 — search for the Gregorian offset

```bash
grep -nE "122192928e5|12219292800000" main.js
```

**Why it is stable**: `(1970 - 1582) × 365.25 × 24 × 3600 × 1000` is the RFC 4122 UUID v1 time offset; every v1 implementation has it.

---

## 2. Locating PX custom algorithms

### 2.1 ml() hash — djb2 with INT32_MAX

```bash
grep -nE "31\s*\*\s*[a-z]\s*\+.*charCodeAt" main.js
grep -nE "%\s*2147483647" main.js
```

Signature: `(31 * acc + charCodeAt(i)) % 2147483647`. `2147483647` = `INT32_MAX`, the hallmark of the ml function.

### 2.2 ob segment handler — search for the split("|") pattern

```bash
grep -nE 'split\("\|"\)' main.js
# Usually immediately followed by .shift() or [0] to take the handler byte
grep -nE 'split\(.~~~~.\)' main.js   # ob segment delimiter
```

**Why it is stable**: `~~~~` (4 tildes) and `|` are the PX protocol format, hardcoded on the server; the client must use the same ones.

### 2.3 set_cookie handler — search for "_px3" or "bake"

```bash
grep -nE '"bake"|jb\("YmFrZQ=="\)|atob\("YmFrZQ=="\)' main.js
# YmFrZQ== is the base64 of "bake"
grep -nE '"_px3"' main.js
```

The set_cookie handler is generally right after the `bake` marker.

### 2.4 PC computation — search for HMAC + digit extraction

```bash
# PC formula: digits = chars in '0'-'9' (ASCII 48-57), letters → a%10
grep -nE ">=\s*48.*<=\s*57|charCodeAt.*%\s*10" main.js
# Find the code block right after the HMAC-MD5 hex
```

### 2.5 SID Unicode steganography — search for the Plane 14 Tag Char

```bash
grep -nE "917760|0xE0100|fromCodePoint" main.js
```

**Why it is stable**: `0xE0100` (= 917760) is the start of the Unicode Plane 14 Tag Characters.

### 2.6 anti-tamper — search for % 10 + 1 / % 10 + 2

```bash
grep -nE "%\s*10\s*\+\s*[12]" main.js
```

Signature: uses `state.no % 10 + 1` and `+ 2` to generate the dynamic XOR strength.

### 2.7 djb2 hash variant (Kt)

```bash
grep -nE "<<\s*5\)\s*-\s*[a-z]" main.js
# Signature: (e << 5) - e + ...
```

### 2.8 hash field algorithm — search for 2863

```bash
grep -nE "2863" main.js
grep -nE "charCodeAt\(9\)" main.js
# Patterns like vid.charCodeAt(9) * 2863
```

---

## 3. Locating protocol constants

### 3.1 collector endpoint

```bash
grep -nE "/api/v2/collector|/b/s" main.js
grep -nE "px-cloud\.net" main.js
```

The hostname is always `collector-{lowercase appId}.px-cloud.net`.

### 3.2 /ns speed-test endpoint

```bash
grep -nE "tzm\.px-cloud\.net|/ns\?" main.js
```

### 3.3 TAG / APP_ID / BI constants

```bash
# Usually the 4 constants are packed on one line (var jE = TAG, jF = FT, jG = APP_ID, jH = BI)
# Searching any one of them locates the whole group
grep -nE 'var\s+\w+\s*=\s*"[A-Za-z0-9+/=]{12,}=="' main.js | head -5
# Then verify with this site's known APP_ID
grep -nE '"PXO1GDTa7Q"' main.js  # replace this with the target site's appId
```

### 3.4 default timestamp fallback

```bash
grep -nE "1604064986" main.js
# This is PX's hardcoded fallback timestamp (2020-10-30)
```

---

## 4. Locating entry/dispatch functions (hardest, by shape)

### 4.1 hQ lookup function (string decoder)

```bash
# Find the hP array (usually the longest array literal in the file)
grep -nE ',\s*[a-zA-Z]{1,3}\s*=\s*\[' main.js | head -20
# hM decoder signature (base91 charset)
grep -nE 'F@bt' main.js
# hQ function signature (lookup + cache)
grep -nE 'void\s+0\s*===.*\?.*=' main.js | head -10
```

### 4.2 ob dispatch main function (yU / equivalent)

Pattern: loop → split('~~~~') → split('|') → shift handler → registry lookup → apply.

```bash
grep -nE 'split\("\|"\)' main.js -A 5 | grep -E 'apply|call' | head -5
```

### 4.3 event-construction main entry (mh / equivalent)

Signature: constructs the `payload=`, `appId=`, `tag=`, `uuid=`, `ft=` parameters.

```bash
grep -nE '"payload="|"appId="' main.js
grep -nE '"&pc="|"&cs="|"&sid="' main.js
```

### 4.4 fingerprint-collection main entry (Dd / equivalent)

Signature: consecutive calls to sub-functions ev(t), nv(t), av(t), ov(t), iv(t), cv(t), $d(t), tv(t), etc.

```bash
# Find the block of consecutive short-named function calls
grep -nE '\b[a-z]{1,3}\(t\);\s*[a-z]{1,3}\(t\);\s*[a-z]{1,3}\(t\)' main.js | head -5
```

---

## 5. Locating ev1/ev2 fields — 5 methods

### Method A: reverse-lookup via the decoded hQ dictionary (covers 50%)

```bash
node scripts/extract_hQ.js main.js hQ_map.json
# The generated hQ_map.json contains 1000+ N→string mappings
# Find the N corresponding to your base64 key, then grep hQ(N)
grep -nE "hQ\(\s*N\s*\)" main.js   # N is the number obtained from the reverse lookup
```

### Method B: search for the plaintext ["KEY="] (covers 40%)

```bash
grep -nE '"RTEwewNQMUg="' main.js   # use the field base64 directly
```

### Method C: search for the value's source API (covers environment fields)

```bash
# Decoded value is "Win32" → search navigator.platform
grep -nE 'navigator\.platform' main.js
# Value is 1920 → search screen.width
grep -nE 'screen\.width|screen\[' main.js
# Value is a memory number → search performance.memory
grep -nE 'performance\.memory' main.js
```

The obfuscator **cannot** change browser API names (changing them would break the call), so these are all searchable.

### Method D: search for algorithm magic constants (covers PC/HMAC/hash fields)

| Field semantics | Magic constant / pattern |
|---|---|
| HMAC(uuid, UA) | `iR(oB(), ...)` or similar (immediately after the UA variable) |
| performance.now | `performance.now` or a name like `qQ()` |
| Date.toString | `new Date().toString()` or `Date.prototype.toString` |
| anti-tamper | `% 10 + 2` and `% 10 + 1` |
| hash field | `2863` and `charCodeAt(9)` |
| sid steganography | `0xE0100` / `917760` |

### Method E: cross-sample diff inference (fallback)

Diff each field across 6+ batches of samples:
- Same value → STATIC, copy directly
- Changing value → DYNAMIC, analyze the change pattern (timestamp? random? HMAC?)
- Present in only some batches → CONDITIONAL, session-state related

```bash
node scripts/diff_samples.js event_json batch1 batch2 ... --out diff.json
node scripts/probe_dynamic.js diff.json hQ_map.json main.js
```

---

## 6. Cross-version handler mapping (matched by shape)

⚠️ The wire bytes (e.g. `o111oo1o` / `0lll000l`) may change on every SDK upgrade — **do not identify by handler name**, use the parameter shape.

| handler semantics | shape signature | state field |
|---|---|---|
| server timestamp | 1 arg, `/^1[5-9]\d{11}$/` (13-digit millisecond) | `state.no` |
| challenge_hash | 1 arg, `/^[0-9a-f]{64}$/` (SHA-256) | `state.qa` |
| vid | 3 args, UUID + number + flag | `state.vid` |
| cts | 2 args, UUID + flag | `state.cts` |
| pxsid | 1 arg, UUID | `state.pxsid` |
| session_id (to) | 1-2 args, `/^\d{16,}$/` | `state.to` |
| status code | 1 arg, `/^\d{3}$/` | `state.ao` |
| **set_cookie** | **4+ args, starts with `/^_?px/i`** | **`state.px3 = {name, value, ttl}`** |
| app_id | 1 arg, `/^[a-z0-9]{12,30}$/` | `state.appId` |
| control_flag | 1 arg, `/^[a-z]{2,4}$/` | `state.jf` |
| o111val | 1 arg, `/^\d{4,5}$/` | `state.o111val` |

See `handler-table.md` for details.

---

## 7. Standard locating workflow (getting started on a new SDK)

```
1. Download main.js (~500 KB)
   curl https://client.px-cloud.net/<APPID>/main.min.js > main.js

2. Run extract_hQ.js
   node scripts/extract_hQ.js main.js hQ_map.json
   → 1000+ dictionary entries

3. Run lookup_keys.js
   node scripts/lookup_keys.js hQ_map.json main.js <batch1.ev2>.json
   → each field via hQ / plain / not_found

4. For not_found fields, find each one using Method C/D from this document

5. Run diff_samples + probe_dynamic
   → locate the 33 DYNAMIC fields

6. Capture the ev1/ev2 template (one-shot capture on a cold visit)

7. Write px_cookie.js: implement the algorithm layer per algorithm-chain.md, fields from template + DYNAMIC override

8. Test 10 times. If _px3 is not obtained, troubleshoot in the order of gotchas.md
```

**The entire workflow depends on no line numbers — only on grep patterns + shape matching + value comparison — and is stable across versions.**
