/**
 * type=2 multi-session collection — reverse-engineer the cp1 index→value mapping
 * Usage: node collect_type2.js [sessions=5]
 *
 * Principle: the 4-byte type=2 value depends on the nsd → cp1 shuffle
 *            collect multiple sessions to find the fixed cp1 index→value mapping
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const vm = require('vm');
const crypto = require('crypto');
const { jsdomFromUrl } = require('sdenv');

// === Configuration ===
const URL = 'http://TARGET_HOST/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const SESSIONS = parseInt(process.argv[2]) || 5;

// === Imports required ===
// const { extractKeys, decryptCookieT } = require('../lib/...');
// const { grenKeys } = require('../lib/coder');

let capturedCd = null;
const origRun = vm.runInContext;
vm.runInContext = function(code, ctx, opts) {
    if (typeof code === 'string' && code.includes('$_ts.cd=') && code.length < 5000) {
        const m = code.match(/\$_ts\.cd="([^"]+)"/);
        if (m) capturedCd = m[1];
    }
    return origRun.call(this, code, ctx, opts);
};

async function collectOne() {
    capturedCd = null;
    const dom = await jsdomFromUrl(URL, { userAgent: UA, consoleConfig: { error: () => {} } });
    await new Promise(r => { dom.window.addEventListener('sdenv:exit', r); setTimeout(r, 8000); });
    const cookies = dom.cookieJar.getCookieStringSync(URL);
    const cookieT = cookies.match(/T=([^;]+)/)?.[1];
    dom.window.close();
    return { cd: capturedCd, cookieT };
}

async function main() {
    const results = [];

    for (let i = 0; i < SESSIONS; i++) {
        console.log(`\nSession ${i+1}/${SESSIONS}`);
        const data = await collectOne();

        // TODO: uncomment the code below
        // const keys = extractKeys(data.cd);
        // const basearr = decryptCookieT(data.cookieT, keys);

        // Parse type=2
        // let pos = 0, type2 = null;
        // while (pos < basearr.length) {
        //     const type = basearr[pos], len = basearr[pos+1];
        //     if (type === 2) type2 = [...basearr.slice(pos+2, pos+2+len)];
        //     pos += 2 + len;
        // }

        // Extract keys[29..32] variable names
        // const ascii = a => String.fromCharCode(...a);
        // const varNames = [29,30,31,32].map(i => ascii(keys[i]));

        // Look up the indices in cp1
        // const nsdMatch = data.cd && ... // nsd must be extracted from the session
        // const cp1 = grenKeys(918, nsd);
        // const indices = varNames.map(v => cp1.indexOf(v));

        // results.push({ type2, varNames, cp1Indices: indices });
        // console.log(`  type=2: [${type2}], cp1 indices: [${indices}]`);

        console.log('  cd:', data.cd?.length, 'Cookie T:', data.cookieT?.length);

        if (i < SESSIONS - 1) await new Promise(r => setTimeout(r, 2000));
    }

    // Analysis
    // const allIndices = results.map(r => r.cp1Indices.join(','));
    // const unique = [...new Set(allIndices)];
    // console.log('\nAnalysis results:');
    // if (unique.length === 1) {
    //     console.log(`cp1 indices fixed: [${unique[0]}]`);
    //     console.log('A mapping table can be built:');
    //     results[0].cp1Indices.forEach((idx, i) => {
    //         console.log(`  cp1[${idx}] → ${results[0].type2[i]}`);
    //     });
    // } else {
    //     console.log(`cp1 indices vary: ${JSON.stringify(unique)}`);
    //     console.log('A more sophisticated approach is needed');
    // }

    console.log('\nTODO: uncomment after importing extractKeys/decryptCookieT/grenKeys');
}

main().catch(console.error);
