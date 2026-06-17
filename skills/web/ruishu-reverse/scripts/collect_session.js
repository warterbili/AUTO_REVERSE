/**
 * Ruishu companion-data one-shot collection script
 * Collects the full set of companion data within a single sdenv session
 * Usage: node collect_session.js
 *
 * Outputs:
 *   captured/session.json    - nsd + cd + Cookie S/T + basearr + timestamp
 *   captured/keys_raw.json   - 45 key groups
 *   captured/ts_init.js      - $_ts initialization script
 *   captured/eval_code.js    - eval code (matching variable names)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const vm = require('vm');
const fs = require('fs');
const crypto = require('crypto');
const { jsdomFromUrl } = require('sdenv');

// === Configuration (edit here) ===
const URL = 'http://TARGET_HOST/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

let captured = { cd: null, nsd: null, evalCode: null };

// Hook vm.runInContext — must be set before sdenv executes
const origRun = vm.runInContext;
vm.runInContext = function(code, ctx, opts) {
    if (typeof code === 'string') {
        // Capture the $_ts initialization script (contains cd and nsd)
        if (code.includes('$_ts.cd=') && code.length < 5000) {
            const cdM = code.match(/cd="([^"]+)"/);
            const nsdM = code.match(/nsd=(\d+)/);
            if (cdM) captured.cd = cdM[1];
            if (nsdM) captured.nsd = parseInt(nsdM[1]);
            fs.mkdirSync('captured', { recursive: true });
            fs.writeFileSync('captured/ts_init.js', code);
        }
        // Capture the eval code (>100KB)
        if (code.length > 100000 && !captured.evalCode) {
            captured.evalCode = code;
            fs.mkdirSync('captured', { recursive: true });
            fs.writeFileSync('captured/eval_code.js', code);
        }
    }
    return origRun.call(this, code, ctx, opts);
};

// === The following functions must be imported from lib/ or inlined ===
// const { extractKeys, decryptCookieT } = require('../lib/...');
// A simplified inline version goes here; replace with the full implementation in real use

async function collectAll() {
    console.log('Starting collection:', URL);

    // Run sdenv
    const dom = await jsdomFromUrl(URL, {
        userAgent: UA,
        consoleConfig: { error: () => {} },
    });
    await new Promise(r => {
        dom.window.addEventListener('sdenv:exit', r);
        setTimeout(r, 10000);
    });

    // Extract cookies
    const cookies = dom.cookieJar.getCookieStringSync(URL);
    const cookieT = cookies.match(/T=([^;]+)/)?.[1];
    captured.cookieS = cookies.match(/S=([^;]+)/)?.[1];
    captured.cookieT = cookieT;

    dom.window.close();

    // Save
    fs.mkdirSync('captured', { recursive: true });
    fs.writeFileSync('captured/session.json', JSON.stringify({
        url: URL,
        nsd: captured.nsd,
        cd: captured.cd,
        cookieS: captured.cookieS,
        cookieT: captured.cookieT,
        evalCodeLength: captured.evalCode?.length,
        timestamp: new Date().toISOString(),
    }, null, 2));

    console.log('Collection complete:');
    console.log('  nsd:', captured.nsd);
    console.log('  cd:', captured.cd?.length, 'chars');
    console.log('  eval:', captured.evalCode?.length, 'chars');
    console.log('  Cookie T:', cookieT?.length, 'chars');

    return captured;
}

collectAll().catch(console.error);
