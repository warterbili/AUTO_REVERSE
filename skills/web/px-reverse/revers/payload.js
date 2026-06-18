/**
 * PX payload generator (Jf function)
 *
 * Reconstructed from main.js line 3128-3171 (Jf) + line 666-670 (ee) + line 226 (Q)
 *
 * ═══ Input ═══
 *   events:          Array  — event array (browser fingerprint/behavior data collected by PX)
 *   serverTimestamp:  String — server timestamp, from ni() (returned by ob response or collect response)
 *                             first request passes null/undefined, automatically uses default value "1604064986000"
 *                             subsequent requests pass the state.no decoded from the ob response
 *   uuid:            String — UUID v1, from Xa()
 *
 * ═══ Output ═══
 *   String — interleaved payload string, can be used directly as the value of the POST parameter payload=
 *
 * ═══ Algorithm chain ═══
 *   1. json = serialize(events)              — PX custom JSON serialization (it())
 *   2. xored = XOR(json, 50)                 — XOR each character with 50
 *   3. b64 = base64(xored)                   — base64 encode (Q())
 *   4. o = XOR(base64(serverTimestamp), 10)   — interleave key, 20 chars
 *   5. offsets = getOffsets(o.length, b64.length, uuid) — compute insertion positions
 *   6. result = interleave(o, b64, offsets)   — insert the characters of o into b64
 *
 * ═══ Decode (reverse) ═══
 *   interleaved payload → de-interleave → base64 decode → XOR(50) → JSON
 *   de-interleave: splice(offsets[i]-1, 1) from back to front
 *
 * ═══ Default timestamp ═══
 *   on the first request (Bundle #1 / first collect) ni() returns undefined,
 *   Jf falls back to the "1604064986000" hardcoded in the Wf() string table (main.js:3110,3134)
 *   corresponds to 2020-10-30T17:16:26Z — not a real clock, it is a fixed PX script value
 *
 * Usage:
 *   const generatePayload = require('./payload')
 *   const payload = generatePayload(events, null, uuid)       // first request
 *   const payload = generatePayload(events, state.no, uuid)   // subsequent requests
 */

// ═══ serialize — PX custom JSON serialization (main.js:299-329) ═══

const ESCAPE_RE = /[\\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
const ESCAPE_MAP = {
    '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f',
    '\r': '\\r', '\v': '\\v', '"': '\\"', '\\': '\\\\'
};

function escapeChar(ch) {
    return ESCAPE_MAP[ch] || '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
}

function quoteString(t) {
    ESCAPE_RE.lastIndex = 0;
    return '"' + (ESCAPE_RE.test(t) ? t.replace(ESCAPE_RE, escapeChar) : t) + '"';
}

function serialize(e) {
    const type = typeof e;
    if (type === 'undefined') return '"undefined"';
    if (type === 'boolean') return String(e);
    if (type === 'number') {
        const r = String(e);
        return (r === 'NaN' || r === 'Infinity') ? 'null' : r;
    }
    if (type === 'string') return quoteString(e);
    if (e === null || e instanceof RegExp) return 'null';
    if (e instanceof Date)
        return ['"', e.getFullYear(), '-', e.getMonth() + 1, '-', e.getDate(),
                'T', e.getHours(), ':', e.getMinutes(), ':', e.getSeconds(),
                '.', e.getMilliseconds(), '"'].join('');
    if (Array.isArray(e)) {
        const n = ['['];
        for (let a = 0; a < e.length; a++)
            n.push(serialize(e[a]) || '"undefined"', ',');
        n[n.length > 1 ? n.length - 1 : n.length] = ']';
        return n.join('');
    }
    const n = ['{'];
    for (const o in e) {
        if (e.hasOwnProperty(o) && e[o] !== undefined)
            n.push(quoteString(o), ':', serialize(e[o]) || '"undefined"', ',');
    }
    n[n.length > 1 ? n.length - 1 : n.length] = '}';
    return n.join('');
}

// ═══ ee() — XOR encode/decode (main.js:666-670) ═══

function xor(t, key) {
    let r = '';
    for (let i = 0; i < t.length; i++) r += String.fromCharCode(t.charCodeAt(i) ^ key);
    return r;
}

// ═══ z() — base64 encode (main.js:224-247) ═══
// the SDK's z() first does encodeURIComponent (UTF-8 encoding) then btoa
// equivalent to Buffer.from(str, 'utf-8').toString('base64')
// note: cannot use 'binary' (Latin-1), otherwise characters ≥0x80 have a different number of encoded bytes

function b64encode(t) {
    return Buffer.from(t, 'utf-8').toString('base64');
}

function b64decode_utf8(t) {
    return Buffer.from(t, 'base64').toString('utf-8');
}

// ═══ Qf() — linear scaling (main.js:3126) ═══

function Qf(t, e, n, r, a) {
    return Math.floor((t - e) / (n - e) * (a - r) + r);
}

// ═══ getOffsets — compute interleave offsets (main.js:3138-3157) ═══
// paddingLen = o.length (interleave key length)
// payloadLen = base64 payload length
// uuid = UUID string

function getOffsets(paddingLen, payloadLen, uuid) {
    const h = xor(b64encode(uuid), 10);
    let maxProduct = -1;

    for (let p = 0; p < paddingLen; p++) {
        const row = Math.floor(p / h.length) + 1;
        const col = p >= h.length ? p % h.length : p;
        const product = h.charCodeAt(col) * h.charCodeAt(row);
        if (product > maxProduct) maxProduct = product;
    }

    const offsets = [];
    for (let b = 0; b < paddingLen; b++) {
        const row = Math.floor(b / h.length) + 1;
        const col = b % h.length;
        let product = h.charCodeAt(col) * h.charCodeAt(row);
        if (product >= payloadLen) product = Qf(product, 0, maxProduct, 0, payloadLen - 1);
        while (offsets.indexOf(product) !== -1) product += 1;
        offsets.push(product);
    }

    return offsets.sort((a, b) => a - b);
}

// ═══ interleave — insert key characters into payload (main.js:3158-3169) ═══

function interleave(keyStr, payload, offsets) {
    let result = '', pos = 0;
    const chars = keyStr.split('');
    for (let u = 0; u < keyStr.length; u++) {
        result += payload.substring(pos, offsets[u] - u - 1) + chars[u];
        pos = offsets[u] - u - 1;
    }
    result += payload.substring(pos);
    return result;
}

// ═══ deInterleave — de-interleave (reverse) ═══

function deInterleave(payload, offsets) {
    let chars = payload.split('');
    for (let i = offsets.length - 1; i >= 0; i--)
        chars.splice(offsets[i] - 1, 1);
    return chars.join('');
}

// ═══ default timestamp — first-request fallback value (main.js:3110 Wf string table) ═══
const DEFAULT_TIMESTAMP = "1604064986000";

// ═══ generatePayload — main entry point ═══

function generatePayload(events, serverTimestamp, uuid) {
    // 1. serialize → XOR(50) → base64
    const json = serialize(events);
    const encrypted = b64encode(xor(json, 50));

    // 2. interleave key: XOR(base64(serverTimestamp || default value), 10)
    const ts = serverTimestamp || DEFAULT_TIMESTAMP;
    const o = xor(b64encode(String(ts)), 10);

    // 3. compute offsets
    const offsets = getOffsets(o.length, encrypted.length, uuid);

    // 4. interleave
    return interleave(o, encrypted, offsets);
}

// ═══ decodePayload — decode entry point ═══
// serverTimestamp: pass a known value, or pass null to automatically use the default value
//   first-request payload uses the default value "1604064986000"
//   subsequent-request payload needs the state.no from the ob response

function decodePayload(payload, serverTimestamp, uuid) {
    // 1. interleave key
    const ts = serverTimestamp || DEFAULT_TIMESTAMP;
    const o = xor(b64encode(String(ts)), 10);

    // 2. offsets (use the pre-interleave base64 length, consistent with the encoding side)
    const b64Len = payload.length - o.length;
    const offsets = getOffsets(o.length, b64Len, uuid);

    // 3. de-interleave
    const clean = deInterleave(payload, offsets);

    // 4. base64 decode (UTF-8) → XOR(50)
    const xoredStr = b64decode_utf8(clean);
    let json = '';
    for (let i = 0; i < xoredStr.length; i++)
        json += String.fromCharCode(xoredStr.charCodeAt(i) ^ 50);

    return JSON.parse(json);
}

module.exports = generatePayload;
module.exports.decodePayload = decodePayload;
module.exports.DEFAULT_TIMESTAMP = DEFAULT_TIMESTAMP;
