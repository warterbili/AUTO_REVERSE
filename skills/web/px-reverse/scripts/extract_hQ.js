// Extract the hM decoder + hP array from the new SDK main.js, and output the
// full N → string mapping.
//
// Usage: node extract_hQ.js <SDK path> [output JSON path]
//   SDK path:    PX client main.js / main.min.js
//   output path: defaults to ./hQ_map.json (relative to cwd)
const fs = require('fs');
const path = require('path');

const sdkPath = process.argv[2];
const outPath = process.argv[3] || path.resolve(process.cwd(), 'hQ_map.json');
if (!sdkPath) {
    console.error('Usage: node extract_hQ.js <SDK path> [output JSON path]');
    process.exit(1);
}
const sdk = fs.readFileSync(sdkPath, 'utf-8');

// hM decoder (lines 83-102) — decodes PX's custom base91-ish encoding into bytes, then utf8-decodes
function hM(t) {
    var n = "" + (t || ""), e = n.length, r = [], h = 0, i = 0, o = -1, c = 0;
    for (; c < e; c++) {
        var a = 'F@bt;"m:x3&#LiZ[)TE/}%QD1Iu.6f0R]78|4{zvWC>`$Se(rJ=*c^2_?qOpB,d<AVy~YwoP!+9g5nXhUsNGjaMKHlk'.indexOf(n[c]);
        if (a !== -1) {
            if (o < 0) {
                o = a;
            } else {
                h |= (o += 91 * a) << i;
                i += (8191 & o) > 88 ? 13 : 14;
                do {
                    r.push(255 & h);
                    h >>= 8;
                    i -= 8;
                } while (i > 7);
                o = -1;
            }
        }
    }
    if (o > -1) r.push(255 & (h | (o << i)));
    return Buffer.from(r).toString('utf-8');
}

// Extract the hP array literal (starting at line 29, a very long inline)
// Slice by marker: starts at `, hP = [`, ends at the matching `]`
const start = sdk.indexOf(', hP = [');
if (start < 0) { console.error('hP not found'); process.exit(1); }
let depth = 0, inStr = false, strCh = '', i = start;
// Jump to [
i = sdk.indexOf('[', start);
const arrStart = i;
i++;
depth = 1;
while (i < sdk.length && depth > 0) {
    const c = sdk[i];
    if (inStr) {
        if (c === '\\' && i+1 < sdk.length) { i += 2; continue; }
        if (c === strCh) inStr = false;
        i++; continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; i++; continue; }
    if (c === '[') depth++;
    else if (c === ']') depth--;
    i++;
}
const arrEnd = i;
const arrLit = sdk.slice(arrStart, arrEnd);

// Parse the array literal with eval
let hP;
try { hP = eval(arrLit); } catch (e) { console.error('eval failed:', e.message); process.exit(1); }
console.log(`hP array length: ${hP.length}`);

// Decode each element
const map = {};
for (let n = 0; n < hP.length; n++) {
    try {
        map[n] = hM(hP[n]);
    } catch (e) {
        map[n] = `<decode err: ${e.message}>`;
    }
}

// Output to JSON
fs.writeFileSync(outPath, JSON.stringify(map, null, 2));
console.log('saved', outPath);

// Find all base64-like entries (ending in =, chars A-Za-z0-9+/)
const b64keys = [];
for (const [n, v] of Object.entries(map)) {
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length >= 8 && v.endsWith('=')) {
        b64keys.push({n: +n, key: v});
    }
}
console.log(`\nbase64-like entries: ${b64keys.length}`);
console.log('sample first 30:');
for (const {n, key} of b64keys.slice(0, 30)) {
    console.log(`  hQ(${n}) = "${key}"`);
}
