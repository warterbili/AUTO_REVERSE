# Complete Reconstruction of the PX Encryption Algorithm Chain

The 5 core algorithms the PX SDK uses when posting to the collector — from the raw events object to the server-ready string, end-to-end reproducible. All code is equivalent to the implementation in this skill's bundled `revers/`.

> Note on this document: all code blocks express invisible characters using ASCII escapes (`U+XXXX` text or `\\uXXXX` string literals). The file contains **zero literal control characters**, **zero NUL bytes**, and **zero invisible Unicode** — VSCode / any editor opens it normally.

## Overview

```
events (JS object)
   |
   |-> serialize()         (PX custom, not JSON.stringify)
   |       |
   |       v
   |   '[{"t":...,"d":{...}}]'   (PX-shaped JSON string)
   |       |
   |       |-> xor(., 50)         (char-level XOR, key=50)
   |       v
   |   XORed binary string
   |       |
   |       |-> b64utf8encode()    (must be UTF-8, not Latin-1)
   |       v
   |   base64 string
   |       |
   |       |-> interleave()       (insert padding key at offsets)
   |       v
   |   payload  (sent to server)
   |
   |-> pc = jt(serialize(events), uuid:tag:ft)   (HMAC-MD5 + digit extraction)
   |
   |-> sid = state.pxsid + hh(state.no)          (Unicode Tag Char steganography)
   |
   '-> ev2[at_key] = at_val                       (anti-tamper dynamic XOR)
        at_key = te(state.to, state.no%10+2)
        at_val = te(state.to, state.no%10+1)
```

---

## 1. PX custom serialize (replacement for JSON.stringify)

### 8 differences from JSON.stringify

| Input | JSON.stringify | PX serialize |
|---|---|---|
| `undefined` | skip key | output `'"undefined"'` quoted string |
| `NaN` | throw / null | `'null'` |
| `Infinity` | throw / null | `'null'` |
| `RegExp` | `'{}'` | `'null'` |
| `Date` | ISO zero-padded | `"2026-5-19T3:45:30.123"` not zero-padded |
| property whose value is undefined | skip | output `'"undefined"'` |
| Escape character set | standard | includes `\v` + extra Unicode ranges |
| empty object | `'{}'` | `'{}'` (same) |

### Set of characters that must be escaped

The original SDK expresses this with a single regex `/[\\\"...]/g`. That regex literally contains **real invisible characters**; storing it in a markdown file would make tools treat the file as binary. Here it is described instead using a **pure-ASCII predicate**:

```
code points that must be escaped:
  U+005C   backslash          (\)
  U+0022   double quote       (")
  U+0000 .. U+001F   C0 control chars (NUL .. US)
  U+007F .. U+009F   DEL + C1 control chars
  U+00AD              soft hyphen
  U+0600 .. U+0604   Arabic number signs
  U+070F              Syriac abbreviation mark
  U+17B4, U+17B5     Khmer inherent vowels
  U+200C .. U+200F   ZWNJ / ZWJ / LRM / RLM
  U+2028 .. U+202F   line/paragraph separator + bidi marks + NNBSP
  U+2060 .. U+206F   word joiner + invisible operators
  U+FEFF              BOM / zero-width no-break space
  U+FFF0 .. U+FFFF   Specials block
```

### Full implementation

```javascript
const ESC_MAP = {
    '\b': '\\b',
    '\t': '\\t',
    '\n': '\\n',
    '\f': '\\f',
    '\r': '\\r',
    '\v': '\\v',
    '"':  '\\"',
    '\\': '\\\\',
};

function needsEscape(ch) {
    const c = ch.charCodeAt(0);
    if (c < 0x20) return true;                     // C0 control
    if (c >= 0x7F && c <= 0x9F) return true;       // DEL + C1
    if (c === 0xAD) return true;                   // soft hyphen
    if (c >= 0x600 && c <= 0x604) return true;     // Arabic
    if (c === 0x70F) return true;                  // Syriac
    if (c === 0x17B4 || c === 0x17B5) return true; // Khmer
    if (c >= 0x200C && c <= 0x200F) return true;   // ZWNJ/ZWJ/LRM/RLM
    if (c >= 0x2028 && c <= 0x202F) return true;   // LS/PS/bidi/NNBSP
    if (c >= 0x2060 && c <= 0x206F) return true;   // WJ + invisible operators
    if (c === 0xFEFF) return true;                 // BOM
    if (c >= 0xFFF0) return true;                  // Specials
    if (ch === '"' || ch === '\\') return true;
    return false;
}

function escapeChar(ch) {
    if (ch in ESC_MAP) return ESC_MAP[ch];
    return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
}

function quoteString(t) {
    let out = '"';
    for (const ch of t) {
        out += needsEscape(ch) ? escapeChar(ch) : ch;
    }
    return out + '"';
}

function serialize(e) {
    const type = typeof e;
    if (type === 'undefined') return '"undefined"';
    if (type === 'boolean')   return String(e);
    if (type === 'number') {
        const r = String(e);
        return (r === 'NaN' || r === 'Infinity') ? 'null' : r;
    }
    if (type === 'string') return quoteString(e);
    if (e === null || e instanceof RegExp) return 'null';
    if (e instanceof Date) {
        return ['"', e.getFullYear(), '-', e.getMonth() + 1, '-', e.getDate(),
                'T', e.getHours(), ':', e.getMinutes(), ':', e.getSeconds(),
                '.', e.getMilliseconds(), '"'].join('');
    }
    if (Array.isArray(e)) {
        const n = ['['];
        for (let a = 0; a < e.length; a++) n.push(serialize(e[a]) || '"undefined"', ',');
        n[n.length > 1 ? n.length - 1 : n.length] = ']';
        return n.join('');
    }
    const n = ['{'];
    for (const o in e) {
        if (Object.prototype.hasOwnProperty.call(e, o) && e[o] !== undefined) {
            n.push(quoteString(o), ':', serialize(e[o]) || '"undefined"', ',');
        }
    }
    n[n.length > 1 ? n.length - 1 : n.length] = '}';
    return n.join('');
}
```

Note: the original SDK uses the regex `/[\\\"<a bunch of literal control chars>]/g`. Here we express it equivalently with the `needsEscape()` function to avoid writing literal control characters into markdown.

---

## 2. XOR / Base64 / Interleave (payload encryption)

### XOR (char-level)

```javascript
function xor(t, key) {
    let n = '';
    for (let i = 0; i < t.length; i++) {
        n += String.fromCharCode(t.charCodeAt(i) ^ key);
    }
    return n;
}

// anti-tamper alias
const te = xor;
```

Quick reference for XOR key usage:

| Scenario | key |
|---|---|
| payload encryption | `50` |
| paddingKey derivation | `10` |
| OB decode | `ml(TAG) % 128` |
| anti-tamper key | `parseInt(state.no) % 10 + 2` |
| anti-tamper value | `parseInt(state.no) % 10 + 1` |

### Base64 (must be UTF-8)

```javascript
function b64encode(t) {
    return Buffer.from(t, 'utf-8').toString('base64');
}
```

Fatal trap: **must be UTF-8, not Latin-1**. After XOR(50), characters may land in the 0x80-0xFF range; UTF-8 encodes them to 2-3 bytes while Latin-1 encodes them to 1 byte. The differing length → PC verification fails.

### Interleave (Jf function)

```javascript
function Qf(t, e, n, r, a) {
    // linear map [e, n] -> [r, a]
    return Math.floor((t - e) / (n - e) * (a - r) + r);
}

function getOffsets(paddingLen, payloadLen, uuid) {
    const h = xor(b64encode(uuid), 10);
    let maxProduct = -1;

    for (let p = 0; p < paddingLen; p++) {
        const row = Math.floor(p / h.length) + 1;
        const col = p % h.length;
        const product = h.charCodeAt(col) * h.charCodeAt(row);
        if (product > maxProduct) maxProduct = product;
    }

    const offsets = [];
    for (let b = 0; b < paddingLen; b++) {
        const row = Math.floor(b / h.length) + 1;
        const col = b % h.length;
        let product = h.charCodeAt(col) * h.charCodeAt(row);
        if (product >= payloadLen) {
            product = Qf(product, 0, maxProduct, 0, payloadLen - 1);
        }
        while (offsets.indexOf(product) !== -1) product += 1;  // collision +1
        offsets.push(product);
    }
    return offsets.sort((a, b) => a - b);
}

function interleave(key, payload, offsets) {
    let result = '', pos = 0;
    for (let i = 0; i < key.length; i++) {
        result += payload.substring(pos, offsets[i] - i - 1) + key[i];
        pos = offsets[i] - i - 1;
    }
    return result + payload.substring(pos);
}

function generatePayload(events, serverTs, uuid) {
    const json = serialize(events);
    const encrypted = b64encode(xor(json, 50));
    const ts = serverTs || '1604064986000';   // PX default fallback ts
    const paddingKey = xor(b64encode(String(ts)), 10);   // 20-char key
    const offsets = getOffsets(paddingKey.length, encrypted.length, uuid);
    return interleave(paddingKey, encrypted, offsets);
}
```

Server-side reverse operation: recompute offsets with `uuid + state.no` → strip padding chars → base64 decode → XOR(50) → JSON.parse.

---

## 3. PC = HMAC-MD5 + digit extraction

```javascript
function hmacMD5(data, key) {
    // PX's own MD5 + HMAC, see revers/pc.js
    // Node built-in equivalent:
    //   require('crypto').createHmac('md5', key).update(data).digest('hex')
}

function generatePC(events, uuid, tag, ft) {
    const data = serialize(events);
    const salt = uuid + ':' + tag + ':' + ft;
    const n = hmacMD5(data, salt);   // 32 hex chars

    let digits = '', letters = '';
    for (let r = 0; r < n.length; r++) {
        const a = n.charCodeAt(r);
        if (a >= 48 && a <= 57) {
            digits += n[r];           // '0'-'9' kept as-is
        } else {
            letters += a % 10;         // 'a'-'f' -> ASCII mod 10
        }
    }
    const combined = digits + letters;
    let pc = '';
    for (let o = 0; o < combined.length; o += 2) {
        pc += combined[o];             // take every even-indexed position
    }
    return pc;   // 16 digits
}
```

Essence of the algorithm: split the 32 hex chars into a "raw digits" segment + a "letters-converted-to-digits" segment, concatenate them, then **take every even-indexed position** to get the 16-digit PC.

---

## 4. OB decode

```javascript
function ml(t) {
    // djb2 variant with INT32_MAX modulo
    let e = 0;
    for (let n = 0; n < t.length; n++) {
        e = (31 * e + t.charCodeAt(n)) % 2147483647;
    }
    return (e % 900 + 100).toString();
}

function decodeOb(responseJson, gt) {
    const xorKey = parseInt(ml(gt), 10) % 128;
    const parsed = JSON.parse(responseJson);
    const ob = parsed.do || parsed.ob;
    if (!ob) return { state: {} };

    // Key point: use 'binary', not 'utf-8' — OB is server-side binary-encoded
    const decoded = Buffer.from(ob, 'base64').toString('binary');
    const segments = xor(decoded, xorKey).split('~~~~');

    const state = {};
    for (const seg of segments) {
        const fields = seg.split('|');
        fields.shift();   // discard the handler byte (matching by args shape is more stable)
        const args = fields;

        // match by argument shape (stable across SDK versions)
        if (args.length === 1 && /^1[5-9]\d{11}$/.test(args[0])) {
            state.no = args[0];   // 13-digit ms timestamp
        } else if (args.length === 1 && /^[0-9a-f]{64}$/.test(args[0])) {
            state.qa = args[0];   // 64 hex challenge hash
        } else if (args.length === 1 && /^[a-f0-9-]{36}$/.test(args[0])) {
            state.pxsid = args[0];
        } else if (args.length === 1 && /^\d{16,}$/.test(args[0])) {
            state.to = args[0];   // anti-tamper seed
        } else if (args.length === 1 && /^[a-z0-9]{12,30}$/.test(args[0])) {
            state.appId = args[0];
        } else if (args.length === 1 && /^[a-z]{2,4}$/.test(args[0])) {
            state.jf = args[0];
        } else if (args.length === 2 && /^[a-f0-9-]{36}$/.test(args[0])) {
            state.cts = args[0];
        } else if (args.length === 3 && /^[a-f0-9-]{36}$/.test(args[0])) {
            state.vid = args[0];
        } else if (args.length >= 4 && /^_?px/i.test(args[0])) {
            state.px_cookie = {
                name: args[0],
                ttl: parseInt(args[1]),
                value: args[2]
            };
        }
    }
    return { state };
}
```

For the complete 27-handler table, see `references/handler-table.md`.

---

## 5. SID Unicode Tag Char steganography

```javascript
function hh(t) {
    let result = '';
    for (let i = 0; i < t.length; i++) {
        // Plane 14 Tag Characters start at U+E0100
        result += String.fromCodePoint(0xE0100 + t.charCodeAt(i));
    }
    return result;
}

function generateSid(pxsid, serverTimestamp) {
    return pxsid + hh(String(serverTimestamp));
}
```

Output characteristics:
- Visually, the sid length = 36 (the UUID part)
- Actual UTF-8 byte count = `36 + |state.no| * 4` (each Tag Char takes 4 bytes in UTF-8)
- Typical value: `36 + 13 * 4 = 88` bytes

Defensive purpose: terminals / certain HTTP clients **drop** Tag Characters, which changes the sid byte count → the server flags it as non-browser. See `docs/zh/16_sid_steg.md` for details.

---

## 6. Anti-Tamper dynamic XOR

```javascript
const ANTI_TAMPER_RE = /^[0-9:;<=>?@]{15,25}$/;

function injectAntiTamper(events_d, state) {
    const stateNo = parseInt(state.no, 10);
    const key = te(state.to, stateNo % 10 + 2);
    const val = te(state.to, stateNo % 10 + 1);

    // Key point: rebuild the dict preserving original order (do not delete + add)
    const newD = {};
    for (const k of Object.keys(events_d)) {
        if (ANTI_TAMPER_RE.test(k) && ANTI_TAMPER_RE.test(String(events_d[k]))) {
            newD[key] = val;
        } else {
            newD[k] = events_d[k];
        }
    }
    return newD;
}
```

Character-range explanation: `state.to` is pure-digit ASCII (0x30-0x39); after XOR (1-12) the output lands in the 0x30-0x40 range, corresponding to the characters `0-9:;<=>?@`.

For the full threat-model analysis, see `docs/references/ANTI_TAMPER_FORMALISM.md`.

---

## 7. UUID v1 (RFC 4122)

Standard RFC 4122 v1. Key magic constant: `122192928e5` = the number of milliseconds from 1582-10-15 to 1970-01-01. Full implementation in `revers/uuid.js`.

---

## 8. djb2 hash variant (Kt)

```javascript
function Kt(t) {
    t = '' + t;
    let e = 0;
    for (let n = 0; n < t.length; n++) {
        e = (e << 5) - e + t.charCodeAt(n);
        e |= 0;   // force int32
    }
    if (e < 0) e += 4294967296;
    return e.toString(16);
}

function generateHash(serverNo, vid) {
    const ao = Math.floor(parseInt(serverNo) / 1000);
    return Kt(Math.floor((ao * 2863) / vid.charCodeAt(9)));
}
```

`2863` and `vid.charCodeAt(9)` are PX hard-coded magic constants.

---

## Empirical consistency verification

This skill's bundled `revers/` modules have passed round-trip verification across 12 sample batches (iFood 6 + Grubhub 6):

```bash
node scripts/verify_batch.js samples/ifood/{1..6}
PX_TAG="FmYgK1gdJEAP" node scripts/verify_batch.js samples/grubhub/{1..6}
```

Expected output: `6/6 batches round-trip clean` (both times). Any failure = the algorithm implementation is inconsistent with the SDK → bisect `revers/`.

See `docs/references/REPRODUCIBILITY.md` § 6 for details.

---

## Related documents

- `docs/zh/04_algorithm_chain.md` — the project's main document on the same topic
- `docs/references/PROTOCOL_GRAMMAR.md` — formal BNF grammar
- `docs/references/ANTI_TAMPER_FORMALISM.md` — Anti-tamper threat model
- `references/locate-by-pattern.md` — cross-version location
- `references/handler-table.md` — complete OB handler table
- `references/gotchas.md` — the 23 major gotchas
