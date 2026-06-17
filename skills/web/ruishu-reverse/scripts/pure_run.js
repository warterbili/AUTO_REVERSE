/**
 * Ruishu Cookie T pure-algorithm generation — fully dynamic, zero local dependencies
 * Usage: node pure_run.js
 *
 * Flow:
 *   1. GET → 412 + cd + nsd + Cookie S
 *   2. GET mainjs URL → mainjs source
 *   3. extractKeys(cd) → keys
 *   4. new Coder(nsd, cd, mainjs).run() → eval code + codeUid
 *   5. buildBasearr(config, keys) → basearr
 *   6. generateCookie(basearr, keys) → Cookie T
 *   7. GET with Cookie S + Cookie T → 200
 */
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === Configuration (edit here) ===
const HOST = 'TARGET_HOST';
const PORT = 80;
const PATH = '/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// === Imports required ===
// const { Coder, grenKeys } = require('../lib/coder');
// const { buildBasearr, crc32 } = require('../lib/basearr');
// const { extractKeys } = require('./key_extraction'); // or inline
// const { generateCookie } = require('./encryption'); // or inline

function httpGet(p, cookie) {
    return new Promise((resolve, reject) => {
        const h = { 'User-Agent': UA, 'Host': `${HOST}:${PORT}` };
        if (cookie) h['Cookie'] = cookie;
        http.request({ hostname: HOST, port: PORT, path: p, headers: h }, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
        }).on('error', reject).end();
    });
}

async function main() {
    // Step 1: GET → 412
    console.log('Step 1: Fetching 412...');
    const r1 = await httpGet(PATH);
    if (r1.status !== 412) { console.log('Not Ruishu:', r1.status); return; }

    const cd = r1.body.match(/\$_ts\.cd="([^"]+)"/)[1];
    const nsd = parseInt(r1.body.match(/\$_ts\.nsd=(\d+)/)[1]);
    const cookieS = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    console.log('  nsd:', nsd, 'cd:', cd.length, 'chars');

    // Step 2: Download mainjs (cached)
    console.log('Step 2: Downloading mainjs...');
    const jsUrl = r1.body.match(/src="([^"]+\.js)"/)[1];
    const cache = path.join(__dirname, 'mainjs_cache.js');
    let mainjs;
    if (fs.existsSync(cache)) {
        mainjs = fs.readFileSync(cache, 'utf-8');
        console.log('  Using cache:', cache);
    } else {
        mainjs = (await httpGet(jsUrl)).body;
        fs.writeFileSync(cache, mainjs);
        console.log('  Download complete:', mainjs.length, 'chars');
    }

    // Step 3: Extract keys
    console.log('Step 3: Extracting keys...');
    // const keys = extractKeys(cd);
    // const cookieName = String.fromCharCode(...keys[7]).split(';')[5] + 'T';
    // console.log('  keys:', keys.length, 'groups, Cookie name:', cookieName);

    // Step 4: Coder → codeUid
    console.log('Step 4: Coder...');
    // const coder = new Coder(nsd, cd, mainjs);
    // coder.run();
    // const codeUid = computeCodeUid(coder, keys);
    // console.log('  eval:', coder.code.length, 'chars, codeUid:', codeUid);

    // Step 5: basearr
    console.log('Step 5: basearr...');
    // const cp1 = grenKeys(coder.keynameNum, nsd);
    // const basearr = buildBasearr({
    //     userAgent: UA, pathname: PATH, hostname: HOST,
    //     platform: 'Win32', flag: 2830, codeUid,
    //     execNumberByTime: 1600, randomAvg: [50, 8],
    //     innerHeight: 768, innerWidth: 1024,
    //     outerHeight: 768, outerWidth: 1024,
    //     documentHidden: false, _cp1: cp1,
    //     runTime: Math.floor(Date.now()/1000),
    //     startTime: Math.floor(Date.now()/1000) - 1,
    //     currentTime: Date.now(),
    // }, keys);
    // console.log('  basearr:', basearr.length, 'bytes');

    // Step 6: Encrypt
    console.log('Step 6: Encrypting...');
    // const cookieT = generateCookie(basearr, keys);
    // console.log('  Cookie T:', cookieT.length, 'chars');

    // Step 7: Verify
    console.log('Step 7: Verifying...');
    // const r2 = await httpGet(PATH, [cookieS, cookieName + '=' + cookieT].join('; '));
    // console.log('Result:', r2.status === 200 ? 'Verification passed!' : 'Failed: ' + r2.status);

    console.log('TODO: uncomment after importing the implementations from lib/');
}

main().catch(console.error);
