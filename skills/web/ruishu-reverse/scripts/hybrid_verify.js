/**
 * Hybrid verification: sdenv basearr + pure-algorithm encryption = 200
 * Proves the encryption chain is correct independently of basearr correctness
 * Usage: node hybrid_verify.js
 *
 * Principle: take the real basearr from sdenv and re-encrypt it with the pure-algorithm generateCookie
 *            a 200 response confirms the encryption chain is 100% correct
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const vm = require('vm');
const crypto = require('crypto');
const http = require('http');
const { jsdomFromUrl } = require('sdenv');

// === Configuration ===
const HOST = 'TARGET_HOST';
const PORT = 80;
const PATH = '/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// === Functions to import ===
// const { extractKeys, decryptCookieT, generateCookie } = require('../lib/...');

function httpGet(path, cookie) {
    return new Promise((resolve, reject) => {
        const h = { 'User-Agent': UA, 'Host': `${HOST}:${PORT}` };
        if (cookie) h['Cookie'] = cookie;
        http.request({ hostname: HOST, port: PORT, path, headers: h }, res => {
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

async function hybridVerify() {
    // 1. Fetch 412 + cd
    const r1 = await httpGet(PATH);
    console.log('Step 1: GET →', r1.status);
    if (r1.status !== 412) { console.log('Not Ruishu protection'); return; }

    const cd = r1.body.match(/\$_ts\.cd="([^"]+)"/)?.[1];
    const cookieS = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // 2. Extract keys
    // const keys = extractKeys(cd);
    // const cookieName = String.fromCharCode(...keys[7]).split(';')[5] + 'T';

    // 3. Obtain the real Cookie T via sdenv
    const url = `http://${HOST}:${PORT}${PATH}`;
    const dom = await jsdomFromUrl(url, { userAgent: UA, consoleConfig: { error: () => {} } });
    await new Promise(r => { dom.window.addEventListener('sdenv:exit', r); setTimeout(r, 8000); });
    const cookies = dom.cookieJar.getCookieStringSync(url);
    const cookieT = cookies.match(/T=([^;]+)/)?.[1];
    dom.window.close();

    // 4. Decrypt Cookie T → basearr
    // const realBasearr = decryptCookieT(cookieT, keys);
    // console.log('basearr:', realBasearr.length, 'bytes');

    // 5. Re-encrypt with the pure algorithm
    // const newCookieT = generateCookie(realBasearr, keys);

    // 6. Verify
    // const r2 = await httpGet(PATH, cookieS + '; ' + cookieName + '=' + newCookieT);
    // console.log('Step 6: Hybrid verification →', r2.status);
    // console.log(r2.status === 200 ? 'Encryption chain verified!' : 'Encryption chain is wrong, do not proceed');

    console.log('TODO: uncomment after importing extractKeys/decryptCookieT/generateCookie');
}

hybridVerify().catch(console.error);
