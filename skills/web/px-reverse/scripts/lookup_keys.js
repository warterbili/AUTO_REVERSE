// Reverse-lookup each ev2 key to its N in the hQ table, or mark it as "appears in plaintext SDK"
//
// Usage: node lookup_keys.js <hQ_map.json> <SDK path> <ev2 sample JSON> [output JSON]
//   ev2 sample: a [{t,d}] array (e.g. event_json/batch1_2.json)
const fs = require('fs');
const path = require('path');

if (process.argv.length < 5) {
    console.error('Usage: node lookup_keys.js <hQ_map.json> <SDK path> <ev2 sample JSON> [output JSON]');
    process.exit(1);
}
const hqMapPath = path.resolve(process.argv[2]);
const sdkPath = path.resolve(process.argv[3]);
const ev2Path = path.resolve(process.argv[4]);
const outPath = process.argv[5] || path.resolve(process.cwd(), 'lookup_result.json');

const map = require(hqMapPath);
const sdk = fs.readFileSync(sdkPath, 'utf-8');
const ev2 = require(ev2Path)[0].d;

// Reverse table: string -> N
const rev = {};
for (const [n, v] of Object.entries(map)) {
    if (!(v in rev)) rev[v] = +n;
}

const found_via_hQ = [];
const found_plain = [];
const not_found = [];

for (const key of Object.keys(ev2)) {
    if (key in rev) {
        found_via_hQ.push({key, N: rev[key]});
    } else {
        // Check whether "KEY" appears in plaintext in the SDK
        const lit = `"${key}"`;
        if (sdk.includes(lit)) {
            found_plain.push({key});
        } else {
            not_found.push({key});
        }
    }
}

console.log(`EV2 keys (${Object.keys(ev2).length} total):`);
console.log(`  via hQ(N): ${found_via_hQ.length}`);
console.log(`  plain "key=" in SDK: ${found_plain.length}`);
console.log(`  not found anywhere: ${not_found.length}`);

console.log('\n--- found_plain (first 30) ---');
for (const o of found_plain.slice(0,30)) console.log(`  "${o.key}"`);

console.log('\n--- found_via_hQ (first 30) ---');
for (const o of found_via_hQ.slice(0,30)) console.log(`  ${o.key} = hQ(${o.N})`);

console.log('\n--- not_found (full list) ---');
for (const o of not_found) console.log(`  "${o.key}"`);

fs.writeFileSync(outPath, JSON.stringify({found_via_hQ, found_plain, not_found}, null, 2));
console.log('\nsaved', outPath);
