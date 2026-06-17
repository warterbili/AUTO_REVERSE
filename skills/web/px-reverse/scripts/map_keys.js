// Old ev2 → new ev2 base64 key mapper
// Strategy: match by value. Each old-version key has a known value; the new-version
// batch1 key with the same value is the same semantic field.
//
// Usage: node map_keys.js <old px_cookie.js> <new ev2 sample JSON> [output JSON]
//   old px_cookie.js: old-version generator. Must contain the hardcoded ev2 d object,
//                     starting at "XQUnAxtpIzE=" and ending at the "// anti-tamper" comment.
//                     If your old script does not match this format, instead prepare
//                     oldEv2.json manually (key→raw string) and bypass the parsing logic.
const fs = require('fs');
const path = require('path');

if (process.argv.length < 4) {
    console.error('Usage: node map_keys.js <old px_cookie.js> <new ev2 sample JSON> [output JSON]');
    process.exit(1);
}
const oldPxCookiePath = path.resolve(process.argv[2]);
const newEv2Path = path.resolve(process.argv[3]);
const outPath = process.argv[4] || path.resolve(process.cwd(), 'key_mapping.json');

const pxCookie = fs.readFileSync(oldPxCookiePath, 'utf-8');

// Locate the hardcoded ev2 d{} section. Located manually: starting around line ~302, ev2[0].d = {...}
// Simple approach: slice from 'XQUnAxtpIzE=' (old t) up to the line before anti-tamper
const startMatch = pxCookie.indexOf('"XQUnAxtpIzE="');
const endMatch = pxCookie.indexOf('// anti-tamper');
if (startMatch === -1 || endMatch === -1) { console.error('failed to locate old ev2 in px_cookie.js'); process.exit(1); }
const blob = pxCookie.slice(startMatch, endMatch);

// Extract each "key":value pattern line by line (regex only, no JS parsing)
const oldEv2 = {};
const reLine = /"([A-Za-z0-9+/=]{8,16})"\s*:\s*(.+?)(?=,\s*"[A-Za-z0-9+/=]{8,16}"\s*:|,\s*$|$)/gms;
// Simplification: split by key
// Match the "key":<value> pattern across the whole text; value may be string/number/object/array/boolean/null
// Use a simple state machine: find "KEY":, then consume the value via bracket/quote matching
let cursor = 0;
while (cursor < blob.length) { let i = cursor;
    const m = /"([A-Za-z0-9+/=]{8,16}=)"\s*:\s*/.exec(blob.slice(i));
    if (!m) break;
    const keyStart = i + m.index;
    const k = m[1];
    let valStart = keyStart + m[0].length;
    // Scan the value until the matching comma/brace/bracket
    let depth = 0, inStr = false, strCh = '', j = valStart;
    while (j < blob.length) {
        const c = blob[j];
        if (inStr) {
            if (c === '\\' && j+1 < blob.length) { j += 2; continue; }
            if (c === strCh) { inStr = false; j++; continue; }
            j++; continue;
        }
        if (c === '"' || c === "'") { inStr = true; strCh = c; j++; continue; }
        if (c === '{' || c === '[' || c === '(') { depth++; j++; continue; }
        if (c === '}' || c === ']' || c === ')') {
            if (depth === 0) break;
            depth--; j++; continue;
        }
        if (c === ',' && depth === 0) break;
        j++;
    }
    const rawV = blob.slice(valStart, j).trim().replace(/,$/, '');
    oldEv2[k] = rawV;
    cursor = j + 1;
}
console.log('Old ev2 keys parsed:', Object.keys(oldEv2).length);

// Load the new-version batch1 ev2 actual values
const newEv2 = JSON.parse(fs.readFileSync(newEv2Path))[0].d;
console.log('New ev2 keys (batch1):', Object.keys(newEv2).length);

// For each old key, find the new-version key with the same value
// Skip overly generic values (true/false/null/0/1) — these cause many collisions
const TOO_GENERIC = new Set(['true','false','null','0','1','""','-1','2','3','4','5','8']);

const mapping = {};
const unmapped_old = [];
let mapped = 0;

for (const [oldK, oldV] of Object.entries(oldEv2)) {
    const oldVTrim = oldV.trim();
    if (TOO_GENERIC.has(oldVTrim)) continue;

    // The old V may be a JS expression (function call / variable) — skip
    if (oldVTrim.includes('(') || oldVTrim.match(/^[a-zA-Z_]\w*$/) || oldVTrim.includes('?')) {
        continue;
    }

    // Try eval-ing the old value as a JS literal (string / number / simple object)
    let oldValParsed;
    try { oldValParsed = eval('(' + oldVTrim + ')'); } catch(e) { continue; }

    const oldJSON = JSON.stringify(oldValParsed);

    // Find the key with an exactly equal value in the new-version ev2
    const candidates = [];
    for (const [newK, newV] of Object.entries(newEv2)) {
        if (JSON.stringify(newV) === oldJSON) candidates.push(newK);
    }

    if (candidates.length === 1) {
        mapping[oldK] = {new: candidates[0], value: oldValParsed};
        mapped++;
    } else if (candidates.length > 1) {
        mapping[oldK] = {new: candidates, value: oldValParsed, ambiguous: true};
    } else {
        unmapped_old.push({old: oldK, value: oldValParsed});
    }
}

console.log(`\nMapped (unique): ${mapped}`);
console.log(`Ambiguous: ${Object.values(mapping).filter(v => v.ambiguous).length}`);
console.log(`Unmapped old: ${unmapped_old.length}`);

// Find keys unique to the new version (no old key maps to them)
const mappedNewKeys = new Set();
for (const m of Object.values(mapping)) {
    if (Array.isArray(m.new)) m.new.forEach(k => mappedNewKeys.add(k));
    else mappedNewKeys.add(m.new);
}
const unmapped_new = Object.keys(newEv2).filter(k => !mappedNewKeys.has(k));
console.log(`Unmapped new: ${unmapped_new.length}`);

fs.writeFileSync(outPath, JSON.stringify({
    summary: {old_total: Object.keys(oldEv2).length, new_total: Object.keys(newEv2).length, mapped_unique: mapped, ambiguous: Object.values(mapping).filter(v=>v.ambiguous).length, unmapped_old: unmapped_old.length, unmapped_new: unmapped_new.length},
    mapping, unmapped_old, unmapped_new
}, null, 2));
console.log('\nsaved to', outPath);

// Show the first 30 unique mappings
console.log('\nfirst 30 unique mappings:');
let i = 0;
for (const [oldK, m] of Object.entries(mapping)) {
    if (i++ >= 30) break;
    if (m.ambiguous) continue;
    const vs = JSON.stringify(m.value).slice(0,40);
    console.log(`  ${oldK}  →  ${m.new}    (${vs})`);
}
