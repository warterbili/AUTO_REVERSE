/**
 * PX sid steganographic encoding
 *
 * Reversed from main.js line 4365-4381 (lh/hh/dh) + line 4424-4426 (sid construction)
 *
 * ═══ Input ═══
 *   uuid:            String — UUID v1, from Xa()
 *   serverTimestamp:  String — server timestamp, from ni() (decoded from ob response)
 *
 * ═══ Output ═══
 *   String — uuid + timestamp encoded as Unicode Tag Characters
 *            e.g. "12b6d3c0-dc88-11f0-af79-f50eccdcaab9󠄱󠄷󠄷..." (36 + 13*2 = 62 chars)
 *
 * ═══ Algorithm ═══
 *   hh(t): each char → U+E0100 + charCode (Unicode Tag Characters, Plane 14)
 *   sid = uuid + hh(serverTimestamp)
 *
 *   Encoding table (digits):
 *     '0' (0x30) → U+E0130    '5' (0x35) → U+E0135
 *     '1' (0x31) → U+E0131    '6' (0x36) → U+E0136
 *     '2' (0x32) → U+E0132    '7' (0x37) → U+E0137
 *     '3' (0x33) → U+E0133    '8' (0x38) → U+E0138
 *     '4' (0x34) → U+E0134    '9' (0x39) → U+E0139
 *
 * ═══ Original implementation (main.js:4365-4373) ═══
 *   var lh = "%uDB40%uDD";
 *   function hh(t) {
 *       return (t||"").split("").reduce(function(t,e){
 *           var n = "" + I(e,0).toString(16), r = T(n,2,"0");
 *           return t + unescape(lh + r)     // concatenate surrogate pair
 *       },"")
 *   }
 *   // Browser: unescape("%uDB40%uDD31") → surrogate pair (0xDB40, 0xDD31) → U+E0131
 *
 * Usage:
 *   const generateSid = require('./sid')
 *   const sid = generateSid(uuid, serverTimestamp)
 */

// ═══ hh() — steganographic encoding (main.js:4366-4373) ═══
// each char → Unicode Tag Character (U+E0100 + charCode)

function hh(t) {
    let result = '';
    for (let i = 0; i < t.length; i++)
        result += String.fromCodePoint(0xE0100 + t.charCodeAt(i));
    return result;
}

// ═══ dh() — steganographic decoding (main.js:4374-4381) ═══

function dh(sid) {
    const uuid = sid.substring(0, 36);
    let timestamp = '';
    for (const ch of sid.substring(36)) {
        const cp = ch.codePointAt(0);
        if (cp >= 0xE0100)
            timestamp += String.fromCharCode(cp - 0xE0100);
    }
    return { uuid, timestamp };
}

// ═══ generateSid — main entry point ═══

function generateSid(uuid, serverTimestamp) {
    return uuid + hh(String(serverTimestamp));
}

module.exports = generateSid;
module.exports.decodeSid = dh;
