/**
 * PX Anti-tamper checksum generator (dynamic key/value field)
 *
 * Reversed from main3.js line 6560-6596 ($d function) + line 657-661 (te function)
 *
 * ═══ Algorithm ═══
 *   1. te(str, xorKey): for each char in the string, compute charCode ^ xorKey
 *   2. key   = te(state.to, state.no % 10 + 2)
 *   3. value = te(state.to, state.no % 10 + 1)
 *   4. event[key] = value
 *
 * ═══ Input ═══
 *   state.to:  String — ob response HUVnQ1sranA= field, 20-digit numeric string (e.g. "61450031257451364026")
 *   state.no:  Number — ob response N2sNLXEGAx4= field, server timestamp ms (e.g. 1772193280663)
 *
 * ═══ Output ═══
 *   { key: String, value: String } — dynamic field inserted into event.d
 *
 * ═══ Original implementation (main3.js:657-661) ═══
 *   function te(t, e) {
 *       for (var n = "", r = 0; r < t.length; r++)
 *           n += String.fromCharCode(e ^ t.charCodeAt(r));
 *       return n
 *   }
 *
 * ═══ Original call site (main3.js:6586) ═══
 *   t[te(t[S(n)] || t[S(i)], t[S(c)] % 10 + 2)] = te(t[S(n)] || t[S(u)], t[S(s)] % 10 + 1)
 *   where:
 *     S(550) → HUVnQ1sranA= (state.to)
 *     S(834) → N2sNLXEGAx4= (state.no)
 *
 * ═══ Verification samples ═══
 *   to=61450031257451364026, no=1772193280663 → key=34105564702104631573, val=25014475613015720462
 *   to=11344390866529290810, no=1772193440633 → key=446116<5=3307<7<5=45, val=557007=4<2216=6=4<54
 *   to=11544856010388826448, no=1772197721603 → key=44011=035456===7311=, val=55100<124547<<<6200<
 *
 * Usage:
 *   const { generateAntiTamper, te } = require('./antitamper')
 *   const { key, value } = generateAntiTamper(stateTo, stateNo)
 *   event.d[key] = value
 */

// ═══ te() — XOR cipher (main3.js line 657-661) ═══

function te(t, e) {
    for (var n = "", r = 0; r < t.length; r++)
        n += String.fromCharCode(e ^ t.charCodeAt(r));
    return n;
}

// ═══ generateAntiTamper — main entry point ═══

/**
 * Generate the anti-tamper dynamic key/value
 *
 * @param {string} stateTo — ob response state.to (HUVnQ1sranA= field, 20-digit numeric string)
 * @param {number} stateNo — ob response state.no (N2sNLXEGAx4= field, server timestamp ms)
 * @returns {{ key: string, value: string }}
 */
function generateAntiTamper(stateTo, stateNo) {
    return {
        key:   te(stateTo, stateNo % 10 + 2),
        value: te(stateTo, stateNo % 10 + 1)
    };
}

module.exports = { generateAntiTamper, te };
