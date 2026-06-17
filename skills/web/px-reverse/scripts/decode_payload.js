#!/usr/bin/env node
/**
 * PX payload decoder
 *
 * Extracts the payload from a curl file under request/ and decodes it to JSON.
 * Supports both Windows cmd (^-escaped) and Unix bash (\-escaped) curl formats.
 *
 * Usage:
 *   node script/decode_payload.js <curl file> [server timestamp] [output file name]
 *
 * Examples:
 *   node script/decode_payload.js request/bundle#1.txt
 *   node script/decode_payload.js request/bundle#2.txt 1771962830422
 *   node script/decode_payload.js request/bundle#1.txt default bundle1
 *
 * Arguments:
 *   curl file        — Required, accepts absolute/relative paths (relative to the project root)
 *   server timestamp — Optional; if omitted or "default", uses the default value "1604064986000"
 *   output file name — Optional, without the .json suffix; if omitted, prompts interactively
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { decodePayload, DEFAULT_TIMESTAMP } = require('../revers/payload');

const ROOT = path.resolve(__dirname, '..');
const JSON_DIR = path.join(ROOT, 'event_json');

// ═══ Manually extract a parameter from the raw body (no URLSearchParams, to preserve +) ═══
function getParam(body, name) {
    const prefix = name + '=';
    const start = body.indexOf(prefix);
    if (start === -1) return null;
    const valStart = start + prefix.length;
    const ampPos = body.indexOf('&', valStart);
    return ampPos === -1 ? body.substring(valStart) : body.substring(valStart, ampPos);
}

// ═══ Parse the curl file, extract the POST body ═══
function extractBody(content) {
    // Windows cmd format: --data-raw ^"...^"
    let m = content.match(/--data-raw\s+\^"([\s\S]+?)\^"\s*$/m);
    if (m) {
        // Remove Windows cmd ^ escapes and line continuations
        return m[1].replace(/\^\n\s*/g, '').replace(/\^(.)/g, '$1');
    }
    // Unix bash format: --data-raw '...' or --data-raw "..."
    m = content.match(/--data-raw\s+['"](.+?)['"]\s*$/ms);
    if (m) return m[1];
    // Fallback: look directly for a payload= prefix
    m = content.match(/(payload=[A-Za-z0-9+/=%&;]+)/);
    if (m) return m[1];
    return null;
}

// ═══ Interactive input ═══
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ═══ main ═══
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: node script/decode_payload.js <curl file> [server timestamp] [output file name]');
        console.error('Example: node script/decode_payload.js request/bundle#1.txt');
        console.error('      node script/decode_payload.js request/bundle#2.txt 1771962830422');
        console.error('      node script/decode_payload.js request/bundle#2.txt 1771962830422 bundle2');
        process.exit(1);
    }

    // 1. Resolve the curl file path
    let curlPath = args[0];
    if (!path.isAbsolute(curlPath)) curlPath = path.resolve(ROOT, curlPath);
    if (!fs.existsSync(curlPath)) {
        console.error('File not found:', curlPath);
        process.exit(1);
    }

    // 2. Resolve the server timestamp
    let ts = args[1];
    if (!ts || ts === 'default' || ts === '0') ts = null;
    const tsDisplay = ts || DEFAULT_TIMESTAMP + ' (default)';

    // 3. Read the curl file, extract the body
    const content = fs.readFileSync(curlPath, 'utf8');
    const body = extractBody(content);
    if (!body) {
        console.error('Unable to extract POST body from the curl file');
        process.exit(1);
    }

    const payload = getParam(body, 'payload');
    const uuid = getParam(body, 'uuid');
    if (!payload) { console.error('payload parameter not found'); process.exit(1); }
    if (!uuid) { console.error('uuid parameter not found'); process.exit(1); }

    console.error('─── Decode info ───');
    console.error('Source file:    ', path.basename(curlPath));
    console.error('uuid:           ', uuid);
    console.error('payload length: ', payload.length);
    console.error('Server timestamp:', tsDisplay);

    // 4. Decode
    let events;
    try {
        events = decodePayload(payload, ts, uuid);
    } catch (e) {
        console.error('Decode failed:', e.message);
        process.exit(1);
    }

    const fieldCount = events[0] && events[0].d ? Object.keys(events[0].d).length : '?';
    console.error('Event type:     ', events[0] && events[0].t);
    console.error('Field count:    ', fieldCount);

    // 5. Determine output file name
    let outName = args[2];
    if (!outName) {
        // Default to the source file name
        const base = path.basename(curlPath, path.extname(curlPath));
        const suggestion = base;
        outName = await ask(`Output file name (without .json, press Enter for ${suggestion}): `);
        if (!outName) outName = suggestion;
    }
    if (!outName.endsWith('.json')) outName += '.json';

    const outPath = path.join(JSON_DIR, outName);
    if (!fs.existsSync(JSON_DIR)) fs.mkdirSync(JSON_DIR, { recursive: true });

    // 6. Write
    const jsonStr = JSON.stringify(events, null, 2);
    fs.writeFileSync(outPath, jsonStr, 'utf8');
    console.error('─── Done ───');
    console.error('Wrote:', outPath);
    console.error('Size:', jsonStr.length, 'bytes');
}

main().catch(e => { console.error(e); process.exit(1); });
