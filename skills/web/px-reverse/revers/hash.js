/**
 * PX fingerprint hash generator (RT0/ewBRNUo= field)
 *
 * Reversed from main3.js line 5711-5799
 *
 * ═══ Algorithm chain ═══
 *   1. ao = Math.floor(parseInt(serverNo) / 1000)  — server timestamp in seconds
 *   2. vid = visitor ID (_pxvid cookie)
 *   3. Select hash function:
 *      - After rotation of the Ed() string array, gd(112) = "bHFLMw==" → atob → "lqK3" → reverse → "3Kql"
 *      - Gh = "3Kql" matches the yd() function (gd(124) = "3Kql")
 *      - Note: the selector and hash function body change across PX script versions
 *   4. yd(): (ao * 2863) / vid.charCodeAt(9)
 *   5. bd(): Kt("" + Math.floor(result)) → 8-digit hex
 *
 * ═══ Function mapping (main3.js version) ═══
 *   Sd(t)       → main entry, sets Nh=event, _h=[ao, Xt(), Pa()], computes Gh, calls all hash functions
 *   yd()        → hash function matched by the current version: (i * 2863) / t.charCodeAt(9)
 *   bd(t)       → writes the result: Nh["RT0/ewBRNUo="] = Kt("" + Math.floor(t))
 *   Kt(t)       → djb2 hash variant, seed=0 → unsigned 32-bit hex
 *   Xt()        → returns vid (variable name is gt in main3.js, set via wt())
 *   ao          → Math.floor(parseInt(state.no) / 1e3)
 *
 * ═══ Key findings ═══
 *   - gd() uses the small Ed() array (25 elements); after rotation:
 *     gd(104) = "RT0/ewBRNUo="  (output field key)
 *     gd(110) = "floor"          (Math.floor)
 *     gd(112) = "bHFLMw=="       (selector input)
 *     gd(123) = "apply"          (Function.apply)
 *     gd(124) = "3Kql"           (matches yd)
 *   - 10 hash functions (sd/ld/fd/hd/dd/vd/pd/Ad/Td/yd), only yd() matches the current version
 *   - Pa() (UUID) is passed in as an argument but unused by yd()
 *   - The result depends only on ao (server timestamp in seconds) and vid.charCodeAt(9)
 *
 * Usage:
 *   const { generateHash, Kt } = require('./hash')
 *   generateHash(serverNo, vid)  // → 8-digit hex string
 */

// ═══ Kt() — djb2 hash variant (main3.js line 625-635) ═══
// seed Wt = 0 (line 592)
function Kt(t) {
    t = '' + t;
    var e = 0;
    for (var n = 0; n < t.length; n++) {
        e = (e << 5) - e + t.charCodeAt(n);
        e |= 0;  // keep as 32-bit integer
    }
    // unsigned conversion
    if (e < 0) e += 4294967296;
    return e.toString(16);
}

// ═══ yd() — hash function for the current version (main3.js line 5699-5710) ═══
// function(i, t, c) { return (i * 2863) / t.charCodeAt(9) }
// i = ao, t = vid, c = uuid (unused)
function hashFunc(ao, vid) {
    return (ao * 2863) / vid.charCodeAt(9);
}

// ═══ bd() — write the result (main3.js line 5711-5716) ═══
// Nh["RT0/ewBRNUo="] = Kt("" + Math.floor(result))

/**
 * Generate the RT0/ewBRNUo= field value
 *
 * @param {string|number} serverNo — OB response state.no (server timestamp in ms, e.g. "1772176017914")
 * @param {string} vid — visitor ID (_pxvid cookie, e.g. "44a3b886-1353-11f1-93c8-59c3048eeccc")
 * @returns {string} 8-digit hex string (e.g. "2ebab2fd")
 */
function generateHash(serverNo, vid) {
    var ao = Math.floor(parseInt(serverNo) / 1e3);
    var result = hashFunc(ao, vid);
    return Kt('' + Math.floor(result));
}

module.exports = { generateHash, Kt };
