/**
 * basearr pure-algorithm generator
 * Verified: HTTP 200
 *
 * When adapting to a new site, the main things to change are:
 *   - buildType3  (field structure -- environment fingerprint)
 *   - buildType7  (flag -- site identifier)
 *   - buildType9  (2B/5B -- site-specific)
 *   - buildType2  (mapping table -- data-driven collection)
 */
const crypto = require('crypto');

// ================================================================
// CRC32
// ================================================================
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[i] = c;
}

function crc32(input) {
    // Convert a string to a UTF-8 byte array first
    if (typeof input === 'string') {
        input = unescape(encodeURIComponent(input))
            .split('')
            .map(c => c.charCodeAt(0));
    }
    let val = 0 ^ -1;
    for (let i = 0; i < input.length; i++) {
        val = (val >>> 8) ^ CRC_TABLE[(val ^ input[i]) & 255];
    }
    return (val ^ -1) >>> 0;
}

// ================================================================
// Numeric conversion helpers
// ================================================================

// 32-bit integer -> 4-byte big-endian array
function numToNumarr4(n) {
    if (Array.isArray(n)) return n.flatMap(x => numToNumarr4(x));
    if (typeof n !== 'number') n = 0;
    return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 16-bit integer -> 2-byte big-endian array
function numToNumarr2(n) {
    if (typeof n !== 'number' || n < 0) n = 0;
    if (n > 65535) n = 65535;
    return [n >> 8, n & 255];
}

// 64-bit integer -> 8-byte big-endian array (split into high/low in JS)
function numToNumarr8(num) {
    if (typeof num !== 'number' || num < 0) num = 0;
    const high = Math.floor(num / 4294967296);
    const low = num % 4294967296;
    return [...numToNumarr4(high), ...numToNumarr4(low)];
}

// String <-> ASCII byte array
function string2ascii(str) {
    return str.split('').map(c => c.charCodeAt(0));
}

function ascii2string(arr) {
    return String.fromCharCode(...arr);
}

// ================================================================
// numarrJoin: concatenate a TLV structure
// Rule: arrays automatically get a length prefix, scalars are appended directly
// ================================================================
function numarrJoin(...args) {
    return args.reduce((ans, it) => {
        if (it === undefined || it === null) return ans;
        if (ans.length === 0) return Array.isArray(it) ? it : [it];
        if (!Array.isArray(it)) return [...ans, it];
        return [...ans, it.length, ...it];
    }, []);
}

// ================================================================
// type=3: environment fingerprint
// Includes UA hash, window dimensions, touch points, URL path hash, etc.
// ================================================================
function buildType3(config) {
    return numarrJoin(
        1,                                                      // subtype
        config.maxTouchPoints || 0,                             // touch points (desktop=0)
        config.evalToStringLength || 33,                        // eval.toString().length
        128,                                                    // fixed value
        ...numToNumarr4(crc32(config.userAgent)),               // UA CRC32 hash
        string2ascii(config.platform || 'MacIntel'),            // navigator.platform
        ...numToNumarr4(config.execNumberByTime || 1600),       // loop performance counter
        ...(config.randomAvg || [50, 8]),                       // Math.random mean/variance
        0, 0,                                                   // reserved
        ...numToNumarr4(16777216),                              // fixed value 0x1000000
        ...numToNumarr4(0),
        ...numToNumarr2(config.innerHeight || 938),             // window.innerHeight
        ...numToNumarr2(config.innerWidth || 1680),             // window.innerWidth
        ...numToNumarr2(config.outerHeight || 1025),            // window.outerHeight
        ...numToNumarr2(config.outerWidth || 1680),             // window.outerWidth
        ...numToNumarr8(0),                                     // canvas/WebGL fingerprint (set to 0 here)
        ...numToNumarr4(0),
        ...numToNumarr4(0),
        ...numToNumarr4(crc32(config.pathname.toUpperCase())),  // URL path CRC32
        ...numToNumarr4(0),
        ...numToNumarr4(0),
        ...numToNumarr4(0),
    );
}

// ================================================================
// type=10: time + network
// Uses keys[21], keys[19], keys[24] to compute the time offset
// ================================================================
function buildType10(config, keys) {
    const r2t = parseInt(ascii2string(keys[21]));               // server-supplied reference time
    const k19 = parseInt(ascii2string(keys[19]));
    const rt = config.runTime || Math.floor(Date.now() / 1000); // current second-level timestamp
    const st = config.startTime || (rt - 1);                    // page load time
    const ct = config.currentTime || Date.now();                // current millisecond timestamp
    const r20 = Math.floor(Math.random() * 1048575);            // 20-bit random number
    const hostname = config.hostname.substr(0, 20);             // take the first 20 characters

    return numarrJoin(
        3, 13,
        ...numToNumarr4(r2t + rt - st),                        // corrected time difference
        ...numToNumarr4(k19),
        ...numToNumarr8(r20 * 4294967296 + ((ct & 0xFFFFFFFF) >>> 0)),  // random high bits + time low bits
        parseInt(ascii2string(keys[24])) || 4,                  // flag byte
        string2ascii(hostname),                                 // hostname ASCII
    );
}

// ================================================================
// type=7: site identifier
// flag and codeUid are site-specific values
// ================================================================
function buildType7(config) {
    return [
        ...numToNumarr4(16777216),                              // fixed value 0x1000000
        ...numToNumarr4(0),
        ...numToNumarr2(config.flag || 2830),                   // site-specific flag (needs adapting)
        ...numToNumarr2(config.codeUid || 0),                   // codeUid
    ];
}

// ================================================================
// type=6: keys[22] AES decryption
// Decode the encrypted content from keys[22], using keys[16] as the AES-128-CBC key
// ================================================================
function buildType6(config, keys) {
    const k22 = ascii2string(keys[22]);

    // ---- BASESTR custom base encoding/decoding ----
    const BS = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

    // Build 6 decode lookup tables
    const dk = [{}, {}, {}, {}, {}, {}];
    for (let i = 0; i < BS.length; i++) {
        const c = BS.charCodeAt(i);
        dk[0][c] = i << 2;
        dk[1][c] = i >> 4;
        dk[2][c] = (i & 15) << 4;
        dk[3][c] = i >> 2;
        dk[4][c] = (i & 3) << 6;
        dk[5][c] = i;
    }

    // Decode every 4 characters into 3 bytes
    const dec = [];
    for (let i = 0; i < k22.length; i += 4) {
        const c = [0, 1, 2, 3].map(j =>
            i + j < k22.length ? k22.charCodeAt(i + j) : undefined
        );
        if (c[1] !== undefined) dec.push(dk[0][c[0]] | dk[1][c[1]]);
        if (c[2] !== undefined) dec.push(dk[2][c[1]] | dk[3][c[2]]);
        if (c[3] !== undefined) dec.push(dk[4][c[2]] | dk[5][c[3]]);
    }

    // ---- AES-128-CBC decryption (first 16 bytes = IV, rest = ciphertext) ----
    const iv = Buffer.from(dec.slice(0, 16));
    const ct = Buffer.from(dec.slice(16));
    const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(keys[16]), iv);
    d.setAutoPadding(false);
    const plain = Buffer.concat([d.update(ct), d.final()]);

    // Manually strip PKCS7 padding
    const pad = plain[plain.length - 1];
    const decrypted = [...plain.slice(0, plain.length - pad)];

    // ---- UTF-8 byte array -> string ----
    function utf8Dec(a) {
        const c = [];
        for (let i = 0; i < a.length; i++) {
            const b = a[i];
            if (b < 128) {
                c.push(b);
            } else if (b < 192) {
                c.push(63); // '?'
            } else if (b < 224) {
                c.push((b & 63) << 6 | a[++i] & 63);
            } else if (b < 240) {
                c.push((b & 15) << 12 | (a[++i] & 63) << 6 | a[++i] & 63);
            } else {
                i += 3;
                c.push(63); // '?'
            }
        }
        return String.fromCharCode(...c);
    }

    const val = parseInt(utf8Dec(decrypted)) || 0;

    return [
        1,
        ...numToNumarr2(0),
        ...numToNumarr2(0),
        config.documentHidden ? 0 : 1,                         // document.hidden state
        ...decrypted,
        ...numToNumarr2(val),
    ];
}

// ================================================================
// type=2: session mapping (data-driven)
// The mapping table must be reverse-derived from 5+ collected sessions; the values below are examples
// ================================================================
function buildType2(config, keys) {
    const cp1 = config._cp1;
    if (!cp1) return [103, 101, 224, 181]; // fallback default values

    // Fixed-value lookup table (obtained from data-driven collection, 20-item cycle)
    const VALUES = [
        103,   0, 102, 203, 224, 181, 108, 240, 101, 126,
        103,  11, 102, 203, 225, 181, 208, 180, 100, 127,
    ];

    return [29, 30, 31, 32].map(i => {
        const n = ascii2string(keys[i]);
        const idx = cp1.indexOf(n);
        return idx >= 0 && idx < VALUES.length ? VALUES[idx] : 0;
    });
}

// ================================================================
// Final assembly: concatenate all segments in type order
// ================================================================
function buildBasearr(config, keys) {
    return numarrJoin(
        3,  buildType3(config),             // environment fingerprint
        10, buildType10(config, keys),      // time + network
        7,  buildType7(config),             // site identifier
        0,  [0],                            // type=0: fixed placeholder
        6,  buildType6(config, keys),       // AES decryption segment
        2,  buildType2(config, keys),       // session mapping
        9,  [8, 0],                         // type=9: site-specific (5B on some sites)
        13, [0],                            // type=13: fixed placeholder
    );
}

module.exports = {
    buildBasearr,
    buildType3,
    buildType10,
    buildType7,
    buildType6,
    buildType2,
    crc32,
    numarrJoin,
    numToNumarr4,
    numToNumarr2,
    numToNumarr8,
    string2ascii,
    ascii2string,
};
