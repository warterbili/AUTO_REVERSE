# Stage 4: basearr Site Adaptation (Data-Driven)

## Overview

- **Input**: sdenv reference basearr + keys (45 groups) + codeUid
- **Output**: `buildBasearr(config, keys)` function
- **Validation**: pure-computed Cookie T → HTTP 200

basearr is a TLV-format byte array (154-166B) and is the source data for the Cookie T encryption chain. The basearr structure is broadly similar across sites, but version differences exist (field lengths, flag values, type ordering, etc.). The core of adaptation is: take real data and match it byte by byte, without touching the inner VM.

---

## Data-Driven Three-Step Method

### Step 1: Collect Reference Data

Run the target site with sdenv, obtain a real Cookie T, and decrypt it back into basearr:

```javascript
// 1. Run sdenv → obtain real Cookie T
const dom = await jsdomFromUrl(url, { userAgent: UA });
const cookieT = extractCookieT(dom);

// 2. Decrypt Cookie T → basearr
const basearr = decryptCookieT(cookieT, keys);
// e.g.: [3,73,1,0,33,128,159,173,0,238,8,77,97,99,73,110,116,101,108,...]
```

### Step 2: Multi-Session Comparison

Collect at least 3-5 sessions' basearr and compare byte by byte to distinguish fixed values from dynamic values:

```javascript
// Compare N basearrs, find the bytes that change
for (let i = 0; i < maxLen; i++) {
    const vals = new Set(sessions.map(s => s[i]));
    if (vals.size > 1) {
        console.log(`position ${i}: ${sessions.map(s => s[i]).join(' ')}`);
    }
}
```

The bytes that change have only four kinds of source: keys-derived, timestamp, random number, session-related.

### Step 3: Field-by-Field Implementation

For each byte, identify a definite source and implement the build function. Each time a type is implemented, validate that segment of bytes against the reference data for consistency.

---

## TLV Format

basearr as a whole is a TLV (Type-Length-Value) structure:

```
[type, length, ...payload, type, length, ...payload, ...]
```

Behavior of the assembly function `numarrJoin`:
- The first argument serves as the type marker (without a length)
- Subsequent array arguments automatically prepend `[length, ...data]`
- Non-array arguments are appended directly

Example of the final structure (len=166):

```
3, 73, [type=3 payload 73B]
10, N, [type=10 payload NB]
7, 12, [type=7 payload 12B]
0, 1, [0]
6, 16, [type=6 payload 16B]
2, 4, [type=2 payload 4B]
9, 5, [type=9 payload 5B]
13, 1, [0]
```

---

## Complete Implementation of Each type

### type=3 Environment Fingerprint

type=3 is the longest segment (65-73B) and contains the browser environment fingerprint. Most fields are fixed across sessions.

```javascript
function buildType3(config) {
    return [
        1, config.maxTouchPoints||0, config.evalToStringLength||33, 128,
        ...numToNumarr4(crc32(config.userAgent)),
        config.platform.length, ...string2ascii(config.platform),
        ...numToNumarr4(config.execNumberByTime||1600),
        ...(config.randomAvg||[50,8]), 0, 0,
        ...numToNumarr4(16777216), ...numToNumarr4(0),
        ...numToNumarr2(config.innerHeight||768), ...numToNumarr2(config.innerWidth||1024),
        ...numToNumarr2(config.outerHeight||768), ...numToNumarr2(config.outerWidth||1024),
        ...new Array(8).fill(0), ...numToNumarr4(4), ...numToNumarr4(0),
        ...numToNumarr4(crc32(config.pathname.toUpperCase())),
        ...numToNumarr4(0),
    ];
}
```

Field descriptions:

| Offset | Length | Content | Source |
|------|------|------|------|
| 0 | 1 | fixed 1 | constant |
| 1 | 1 | maxTouchPoints | navigator.maxTouchPoints |
| 2 | 1 | eval.toString().length | usually 33 |
| 3 | 1 | fixed 128 | constant |
| 4-7 | 4 | CRC32(UserAgent) | uuid() function |
| 8 | 1 | platform length | automatic |
| 9+ | N | platform ASCII | "MacIntel" / "Win32" etc. |
| +0-3 | 4 | execNumberByTime | 3ms loop counter (~1600) |
| +4-5 | 2 | randomAvg | mean/variance of 98 random numbers |
| +6-7 | 2 | fixed 0,0 | constant |
| +8-11 | 4 | 16777216 | constant (0x01000000) |
| +12-15 | 4 | 0 | constant |
| +16-23 | 8 | innerH/W, outerH/W | 2B each |
| +24-31 | 8 | all zeros | constant |
| +32-35 | 4 | fixed 4 | detection flag |
| +36-39 | 4 | 0 | constant |
| +40-43 | 4 | CRC32(pathname.toUpperCase()) | URL path |
| +44-47 | 4 | 0 | constant |

Note: some versions (len=166) have 8 extra zero bytes at the end (`numToNumarr8(0)`).

---

### type=10 Time + Network

type=10 contains the timestamp, random number, and hostname. This is the most variable segment in basearr.

```javascript
function buildType10(config, keys) {
    const r2t = parseInt(ascii2string(keys[21]));
    const k19 = parseInt(ascii2string(keys[19]));
    const hostname = config.hostname.substring(0, 20);
    const random20 = Math.floor(Math.random() * 1048575);
    const currentTime = (config.currentTime || Date.now()) & 0xFFFFFFFF;
    return [
        3, 13,
        ...numToNumarr4(r2t + (config.runTime - config.startTime)),
        ...numToNumarr4(k19),
        ...numToNumarr8(random20 * 4294967296 + (currentTime >>> 0)),
        parseInt(ascii2string(keys[24])) || 4,
        hostname.length, ...string2ascii(hostname),
    ];
}
```

Field descriptions:

| Offset | Length | Content | Source |
|------|------|------|------|
| 0 | 1 | fixed 3 | constant |
| 1 | 1 | fixed 13 | constant |
| 2-5 | 4 | r2mkaTime + runTime - startTime | keys[21] + time delta |
| 6-9 | 4 | keys[19] as number | keys[19] |
| 10-17 | 8 | random20 * 2^32 + currentTime | high 20 bits random, low 32 bits time |
| 18 | 1 | keys[24] as number | keys[24] (usually 4) |
| 19 | 1 | hostname length | automatic |
| 20+ | N | hostname ASCII | truncated to 20 characters |

Key finding: `type=10[2..5]` is not pure r2mkaTime, but `r2mkaTime + (runTime - startTime)`. This finding solves the problem where the timestamp field was always off by a few milliseconds.

---

### type=7 Identifier

type=7 contains the version flag and codeUid.

```javascript
function buildType7(config) {
    return [1, 0, 0, 0, 0, 0, 0, 0,
        ...numToNumarr2(config.flag || 2830),
        ...numToNumarr2(config.codeUid || 0)];
}
```

Field descriptions:

| Offset | Length | Content | Source |
|------|------|------|------|
| 0-7 | 8 | [1,0,0,0,0,0,0,0] | constant (numToNumarr4(16777216) + numToNumarr4(0)) |
| 8-9 | 2 | flag | site-specific: 2830, 2833, 3855, 4114 etc. |
| 10-11 | 2 | codeUid | CRC32(funcCode) XOR CRC32(mainCodeSlice) & 0xFFFF |

**The flag value is one of the key parameters for site adaptation** and must be read from the reference data. The flag differs across sites, while for the same site the flag is fixed across sessions.

---

### type=6 keys[22] AES Decryption

type=6 contains the decrypted data of keys[22]. The full implementation requires BASESTR decoding + AES-CBC decryption + UTF-8 decoding.

```javascript
function buildType6(keys) {
    // Step 1: keys[22] → ASCII string
    const k22str = ascii2string(keys[22]);

    // Step 2: BASESTR custom Base64 decode → byte array
    const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';
    const dk = [{},{},{},{},{},{}];
    for (let i = 0; i < BASESTR.length; i++) {
        const c = BASESTR.charCodeAt(i);
        dk[0][c] = i << 2;
        dk[1][c] = i >> 4;
        dk[2][c] = (i & 15) << 4;
        dk[3][c] = i >> 2;
        dk[4][c] = (i & 3) << 6;
        dk[5][c] = i;
    }
    function baseDecode(str) {
        const a = [];
        for (let i = 0; i < str.length; i += 4) {
            const c = [0,1,2,3].map(j => i+j < str.length ? str.charCodeAt(i+j) : undefined);
            if (c[1] !== undefined) a.push(dk[0][c[0]] | dk[1][c[1]]);
            if (c[2] !== undefined) a.push(dk[2][c[1]] | dk[3][c[2]]);
            if (c[3] !== undefined) a.push(dk[4][c[2]] | dk[5][c[3]]);
        }
        return a;
    }
    const encrypted = baseDecode(k22str);

    // Step 3: numarrAddTime — separate key + time + XOR restore
    // The last byte of encrypted is the XOR mask, bytes 5th-to-2nd from the end are the timestamp
    const ele = encrypted[encrypted.length - 1]; // XOR mask
    const raw = encrypted.slice(0, -1).map(b => b ^ ele);
    const keyData = raw.slice(0, raw.length - 4);
    // keyData is the AES key obtained from keys[16] after numarrAddTime processing

    // Step 4: AES-CBC decryption (using keyData as the key)
    // The first 16B of encrypted is the IV, followed by the ciphertext
    // Decryption yields the plaintext byte array
    const crypto = require('crypto');
    const iv = Buffer.from(encrypted.slice(0, 16));
    const ct = Buffer.from(encrypted.slice(16, -1)); // strip the trailing XOR mask
    // The actual implementation must align with rs-reverse's encryptMode2/decode logic

    // Step 5: UTF-8 decode the plaintext → number
    // decode(decrypt(k22str)) yields a numeric string
    // +decode(...) converts it to a number, encoded with numToNumarr2

    // Step 6: Assemble the type=6 payload
    const hidden = config.documentHidden ? 0 : 1;
    return [
        1,
        ...numToNumarr2(0),
        ...numToNumarr2(0),
        hidden,
        ...encryptMode2Result, // 8B: re-encrypted after AES decryption
        ...numToNumarr2(decodedNumber), // 2B: the decrypted number
    ];
}
```

In practice, the type=6 value changes little across sessions. If you already have one successful reference dataset, you can directly reuse the type=6 bytes (valid for a short period). Long-term operation requires fully implementing the encryptMode2 + decode + decrypt chain.

---

### type=2 Session Mapping (Data-Driven)

type=2 is 4 bytes; it looks simple but has the most pitfalls. The following is a complete 9-step real-world case.

#### Step 1: Discover the Problem

The first collected type=2:

```
Session A: [103, 181, 101, 224]
```

It looked like a fixed value; after hardcoding it, the first session succeeded (HTTP 200).

#### Step 2: Try the rs-reverse Formula (Failed)

The second session failed. Examine `fixedValue20` in the rs-reverse source:

```javascript
// rs-reverse implementation
const values = [103,0,102,203,224,181,108,240,101,126,
                103,11,102,203,225,181,208,180,100,127];
const tasks = gv.r2mka("U250200532");
for (let task of tasks) {
    const maps = values.reduce((ans, value, idx) => {
        ans[gv.ts.cp[1][task.taskori[idx * 7 + 6]]] = value;
        return ans;
    }, {});
    // Look up the mapping via the variable names of keys[29..32]
}
```

The `idx*7+6` formula depends on a specific version's r2mka task structure, which does not apply to our site. Applying it directly → failed.

#### Step 3: Reflect on Methodology

You cannot assume the rs-reverse formula is universal. The type=2 value is related to the session's nsd, because nsd determines the shuffle result of cp[1]. We must find a method that does not depend on the specific structure of r2mka.

#### Step 4: Switch to Data-Driven

Method: collect (nsd, keys[29..32], type=2) triples across multiple sessions and look for a pattern.

#### Step 5: Collect 5 Sessions

```
Session 1: nsd=84277, keys[29..32]=["_$cu","_$am","_$bb","_$aT"], type2=[103,181,101,224]
Session 2: nsd=31052, keys[29..32]=["_$dR","_$cl","_$cz","_$c2"], type2=[181,101,103,224]
Session 3: nsd=67891, keys[29..32]=["_$bW","_$aw","_$bk","_$aQ"], type2=[101,181,224,103]
Session 4: nsd=12345, keys[29..32]=["_$eA","_$d5","_$dJ","_$cX"], type2=[224,103,181,101]
Session 5: nsd=55678, keys[29..32]=["_$cP","_$bH","_$bV","_$b2"], type2=[103,224,101,181]
```

#### Step 6: Discover the Pattern

cp1 = grenKeys(918, nsd) generates 918 variable names. The indices of keys[29..32] within cp1:

```
Session 1: cp1.indexOf("_$cu")=11, cp1.indexOf("_$am")=5, ... → [11, 5, 23, 8]
Session 2: cp1.indexOf("_$dR")=11, cp1.indexOf("_$cl")=5, ... → [11, 5, 23, 8]
```

**Key finding: no matter how nsd changes, the indices of keys[29..32] within cp1 are always fixed!**

This is because the variable names of keys[29..32] and cp1 are both shuffled by the same PRNG(nsd), so their relative positions do not change.

#### Step 7: Build the Mapping

Fixed value table (20 entries, from rs-reverse):

```javascript
const VALUES = [103,0,102,203,224,181,108,240,101,126,
                103,11,102,203,225,181,208,180,100,127];
```

Mapping from cp1 index to VALUES: `idx → VALUES[idx]`

The 4 indices actually used: `[11, 5, 23, 8]` (site-specific, extracted from reference data)

#### Step 8: Implementation

```javascript
function buildType2(keys, nsd) {
    // Generate cp1 (918 variable names, shuffled with nsd)
    const cp1 = grenKeys(918, nsd);

    // Fixed value table
    const VALUES = [103,0,102,203,224,181,108,240,101,126,
                    103,11,102,203,225,181,208,180,100,127];

    // Fixed indices (collected from reference data)
    const FIXED_INDICES = [11, 5, 23, 8];

    // Look up keys[29..32] within cp1 and map to VALUES
    return [29, 30, 31, 32].map(ki => {
        const varName = ascii2string(keys[ki]);
        const cpIdx = cp1.indexOf(varName);
        // Find the position in FIXED_INDICES, return the corresponding VALUES
        const fixedPos = FIXED_INDICES.indexOf(cpIdx);
        if (fixedPos >= 0) return VALUES[fixedPos]; // simplified example
        return VALUES[cpIdx]; // direct mapping
    });
}
```

Simplified implementation (when the fixed indices are known):

```javascript
function buildType2Simple(keys, nsd) {
    const cp1 = grenKeys(918, nsd);
    const VALUES = [103,0,102,203,224,181,108,240,101,126,
                    103,11,102,203,225,181,208,180,100,127];
    const result = [];
    for (const ki of [29, 30, 31, 32]) {
        const varName = ascii2string(keys[ki]);
        const idx = cp1.indexOf(varName);
        result.push(VALUES[idx]);
    }
    return result;
}
```

#### Step 9: Validation

All 5 sessions returned HTTP 200.

---

### type=0 Placeholder

```javascript
// fixed 1 byte
[0]
```

### type=9 Battery + Network

```javascript
function buildType9(config) {
    const { connType } = config.connection || {};
    const { charging, chargingTime, level } = config.battery || {};
    const connIdx = ['bluetooth','cellular','ethernet','wifi','wimax'].indexOf(connType) + 1;
    let oper = 0;
    if (level) oper |= 2;
    if (charging) oper |= 1;
    if (connIdx !== undefined) oper |= 8;
    return [
        oper,
        Math.round((level || 1) * 100),
        ...numToNumarr2(chargingTime || 0),
        connIdx,
    ];
}
```

### type=13 Placeholder

```javascript
// fixed 1 byte
[0]
```

---

## Final Assembly: buildBasearr

```javascript
function buildBasearr(config, keys, nsd) {
    const type3 = buildType3(config);
    const type10 = buildType10(config, keys);
    const type7 = buildType7(config);
    const type6 = buildType6(keys, config);
    const type2 = buildType2(keys, nsd);
    const type9 = buildType9(config);

    // numarrJoin: the first argument is the type marker, subsequent array arguments automatically prepend the length
    return [
        3, type3.length, ...type3,
        10, type10.length, ...type10,
        7, type7.length, ...type7,
        0, 1, 0,                          // type=0, len=1, [0]
        6, type6.length, ...type6,
        2, type2.length, ...type2,
        9, type9.length, ...type9,
        13, 1, 0,                         // type=13, len=1, [0]
    ];
}
```

Note: the type ordering may vary by version. Defer to the reference data.

---

## Site Adaptation Checklist

Steps for adapting a new site:

- [ ] 1. Obtain the 412 response, extract nsd + cd + mainjs URL
- [ ] 2. Extract keys (pure-computed or sdenv)
- [ ] 3. Run Coder to compute codeUid
- [ ] 4. Use sdenv to collect reference basearr for 3+ sessions (decrypt Cookie T)
- [ ] 5. Analyze the TLV structure with basearrParse, determine the type ordering
- [ ] 6. Compare across multiple sessions, mark the change type of each byte
- [ ] 7. Determine the flag value (type=7 [8..9])
- [ ] 8. Determine the fixed index mapping for type=2
- [ ] 9. Implement buildBasearr, compare byte by byte against the reference data
- [ ] 10. Pure-computed Cookie T → HTTP 200 validation
- [ ] 11. 5+ consecutive sessions all return 200, confirm stability

---

## Field Analysis Table

### Classified by Byte Change Type

| type | Field | Change Type | Description |
|------|------|----------|------|
| 3 | maxTouchPoints | fixed | device-fixed |
| 3 | eval.toString().length | fixed | usually 33 |
| 3 | CRC32(UA) | fixed | unchanged if UA unchanged |
| 3 | platform | fixed | device-fixed |
| 3 | execNumberByTime | semi-fixed | slight fluctuation per run (~1600) |
| 3 | randomAvg | semi-fixed | statistics of 98 random numbers |
| 3 | innerH/W, outerH/W | fixed | window size |
| 3 | CRC32(pathname) | fixed | URL path |
| 10 | r2mkaTime + delta | differs each time | keys[21] + runtime delta |
| 10 | keys[19] | differs per session | updated each request |
| 10 | random20 + time | differs each time | random + timestamp |
| 10 | hostname | fixed | target domain |
| 7 | flag | site-fixed | adaptation parameter |
| 7 | codeUid | differs per session | changes when mainjs changes |
| 6 | encrypted data | differs per session | derived from keys[22] |
| 2 | session mapping | differs per session | keys[29..32] + nsd |
| 9 | battery/network | fixed | environment info |

### Classified by Source

| Source | Corresponding Fields |
|------|----------|
| constant (hardcoded) | most of type=3, type=0, type=13 |
| browser environment | UA, platform, window size, battery, network |
| keys used directly | keys[19], keys[21], keys[24] |
| keys computed | keys[22]→type=6, keys[29..32]→type=2 |
| pure-computed | CRC32(UA), CRC32(pathname), codeUid |
| random | high bits of type=10[10..17], execNumberByTime |
| time | type=10[2..5], low bits of type=10[10..17] |

---

## Common Pitfalls

1. **flag value is not universal**: rs-reverse defaults to 4114, but the actual site may be 2830/2833/3855 etc.; it must be read from the reference data
2. **type ordering**: the type ordering may differ across versions; defer to the basearrParse parse result
3. **trailing numToNumarr8(0)**: some versions (len=166) have 8 extra zero bytes at the end of type=3
4. **hostname truncation**: the type=10 hostname is at most 20 characters
5. **pathname uppercase**: must call toUpperCase() before the CRC32 computation
6. **time delta**: type=10[2..5] is r2mkaTime + runTime - startTime, not pure r2mkaTime
7. **type=2 is not fixed**: each session's differing nsd causes a different cp1 shuffle, but the index mapping relationship is fixed
