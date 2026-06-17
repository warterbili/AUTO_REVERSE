#!/usr/bin/env node
/**
 * PX ob response decoder
 *
 * Extracts the ob field from a JSON file under responce/, decodes it, and prints
 * the handler execution results.
 *
 * Usage:
 *   node script/decode_ob.js <gt value> <response JSON file> [output file name]
 *
 * Examples:
 *   node script/decode_ob.js "DXJ9dEscZAAJeA==" responce/bundle#1.json
 *   node script/decode_ob.js "DXJ9dEscZAAJeA==" responce/bundle#2.json bundle2_ob
 *
 * Arguments:
 *   gt value         — Required! XOR seed, hardcoded in the PX main script (main.min.js).
 *                       Find it by globally searching for "gt" in main.min.js; it is a
 *                       base64 string such as "DXJ9dEscZAAJeA==", "DhY8E0h7J2cKHw==", etc.
 *                       The gt value changes with every PX script version update!
 *   response JSON file — Required, JSON containing an .ob or .do field
 *   output file name   — Optional, without the .json suffix; if omitted, prompts interactively
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const processOb = require('../revers/ob');
const { ml, buildSid, getParams } = processOb;

const ROOT = path.resolve(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'responce_result');

// ═══ Interactive input ═══
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ═══ Format output ═══
function formatResults(data) {
    const { xorKey, segments, results, state } = data;
    const output = {
        _info: {
            xorKey,
            segmentCount: segments.length,
            handlerCount: results.length,
        },
        state,
        params: getParams(state),
        segments: segments.map((seg, i) => {
            const r = results.find((_, j) => j === i) || results[i];
            return {
                index: i,
                raw: seg.length > 200 ? seg.substring(0, 200) + '...' : seg,
                ...(r || {})
            };
        }),
    };

    // sid steganography
    const sid = buildSid(state);
    if (sid) output.params.sid_visible = sid.replace(/[^\x20-\x7e]/g, '');

    return output;
}

// ═══ main ═══
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.error('Usage: node script/decode_ob.js <gt value> <response JSON file> [output file name]');
        console.error('');
        console.error('gt value: base64 string hardcoded in the PX main script main.min.js, found by globally searching for "gt"');
        console.error('          Changes with every PX script version update!');
        console.error('');
        console.error('Examples: node script/decode_ob.js "DXJ9dEscZAAJeA==" responce/bundle#1.json');
        console.error('          node script/decode_ob.js "DXJ9dEscZAAJeA==" responce/bundle#2.json bundle2_ob');
        process.exit(1);
    }

    // 1. gt value (required)
    const gt = args[0];

    // 2. Resolve file path
    let filePath = args[1];
    if (!path.isAbsolute(filePath)) filePath = path.resolve(ROOT, filePath);
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        process.exit(1);
    }

    // 3. Read JSON
    const content = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        console.error('JSON parse failed:', e.message);
        process.exit(1);
    }

    const xorKey = parseInt(ml(gt), 10) % 128;
    console.error('─── Decode info ───');
    console.error('Source file:', path.basename(filePath));
    console.error('gt:    ', gt);
    console.error('XOR key:', xorKey);

    // 4. Decode + run handlers
    const data = processOb(parsed, gt);

    console.error('Segments:', data.segments.length);
    console.error('─── Handler results ───');
    for (const r of data.results) {
        const type = r.handlerType || 'unknown';
        const detail = r.result ? JSON.stringify(r.result).substring(0, 80) : '';
        console.error(`  [${type}] ${r.handler} → ${detail || '(state updated)'}`);
    }

    // 5. state summary
    console.error('─── State ───');
    if (data.state.no) console.error('  no (server timestamp):', data.state.no);
    if (data.state.qa) console.error('  qa (cs hash):     ', data.state.qa.substring(0, 20) + '...');
    if (data.state.ao) console.error('  ao (status):      ', data.state.ao);
    if (data.state.jf) console.error('  jf (control):     ', data.state.jf);
    if (data.state.vid) console.error('  vid:              ', data.state.vid);
    if (data.state.cts) console.error('  cts:              ', data.state.cts);
    if (data.state.pxsid) console.error('  pxsid:           ', data.state.pxsid);
    if (data.state.px3) console.error('  _px3 cookie:      ', data.state.px3.value.substring(0, 30) + '...');

    // 6. Determine output file name (must be specified by the user)
    let outName = args[2];
    while (!outName) {
        outName = await ask('Output file name (without .json, required): ');
    }
    if (!outName.endsWith('.json')) outName += '.json';

    const outPath = path.join(RESULT_DIR, outName);
    if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

    // 7. Write
    const output = formatResults(data);
    const jsonStr = JSON.stringify(output, null, 2);
    fs.writeFileSync(outPath, jsonStr, 'utf8');
    console.error('─── Done ───');
    console.error('Wrote:', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
