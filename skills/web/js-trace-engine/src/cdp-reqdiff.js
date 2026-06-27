'use strict';
// cdp-reqdiff.js — "browser works, my replay doesn't" → BYTE-DIFF the two requests, don't theorize.
//
// Captures the BROWSER's real request to a matching endpoint (method, URL, every header, every cookie
// as actually sent) and diffs it against YOUR replay request, surfacing the things that silently break
// replays: missing app-added headers (zp_token/traceId/sign…), and — the classic — cookie VALUE
// ENCODING differences (a token with `+`/`/` the browser stores URL-encoded; your raw replay decodes
// `+`→space server-side → corrupted). Driven by cases/boss-zhipin-web-antidebug, where this exact diff
// would have replaced ~30 rounds of wrong theories.
//
//   node src/cdp-reqdiff.js --port 9540 --match zhipin --url joblist.json [--mine mine.json] [--wait 20000]
//
//   --mine <file>: a JSON {method?, headers?:{}, cookies?:{}} describing YOUR replay request; if given,
//                  the tool prints a structured diff. Without it, it just dumps the browser's request.
//
// Needs chrome-remote-interface. The pure diffRequests()/encodingFlags() are unit-tested without Chrome.

const fs = require('fs');

// ---- pure, testable ---------------------------------------------------------
function parseCookies(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// flag cookie values whose ENCODING is likely to matter (contain chars that change under URL-decode)
function encodingFlags(cookies) {
  const flags = [];
  for (const [k, v] of Object.entries(cookies || {})) {
    const raw = String(v);
    let dec = raw; try { dec = decodeURIComponent(raw); } catch (e) {}
    const looksEncoded = raw !== dec;                 // value already %-encoded
    const hasRiskyRaw = /[+/=]/.test(raw) && !looksEncoded; // raw +,/,= that a server URL-decode would mangle
    if (looksEncoded || hasRiskyRaw) {
      flags.push({ cookie: k, encoded: looksEncoded, rawTail: raw.slice(-12), decodedTail: dec.slice(-12),
        note: looksEncoded ? 'browser stores it URL-ENCODED — your replay must encode too' : 'contains +,/,= — RAW will be corrupted by server URL-decode; URL-encode it' });
    }
  }
  return flags;
}

// diff the browser request against my replay; returns {missingHeaders, headerValueDiffs, cookieDiffs}
function diffRequests(browser, mine) {
  const bh = lc(browser.headers || {}), mh = lc((mine && mine.headers) || {});
  const AUTHy = (k) => /zp|token|trace|sign|nonce|sec-ch|x-/i.test(k);
  const missingHeaders = Object.keys(bh).filter((k) => AUTHy(k) && !(k in mh));
  const headerValueDiffs = Object.keys(bh).filter((k) => k in mh && bh[k] !== mh[k] && AUTHy(k))
    .map((k) => ({ header: k, browser: String(bh[k]).slice(0, 40), mine: String(mh[k]).slice(0, 40) }));
  const bc = browser.cookies || {}, mc = (mine && mine.cookies) || {};
  const cookieDiffs = [];
  for (const k of new Set([...Object.keys(bc), ...Object.keys(mc)])) {
    const b = bc[k], m = mc[k];
    if (b === undefined) { cookieDiffs.push({ cookie: k, issue: 'only in mine' }); continue; }
    if (m === undefined) { cookieDiffs.push({ cookie: k, issue: 'MISSING in mine', browserTail: String(b).slice(-12) }); continue; }
    if (b !== m) {
      let bd = b, md = m; try { bd = decodeURIComponent(b); } catch (e) {} try { md = decodeURIComponent(m); } catch (e) {}
      const sameDecoded = bd === md;
      cookieDiffs.push({ cookie: k, issue: sameDecoded ? 'ENCODING differs (same value, different encoding — match the browser!)' : 'value differs', browserTail: String(b).slice(-12), mineTail: String(m).slice(-12) });
    }
  }
  return { missingHeaders, headerValueDiffs, cookieDiffs };
}
function lc(obj) { const o = {}; for (const k of Object.keys(obj || {})) o[k.toLowerCase()] = obj[k]; return o; }

// ---- CDP driver -------------------------------------------------------------
async function run(argv) {
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const port = parseInt(get('--port', '9222'), 10), host = get('--host', '127.0.0.1');
  const match = get('--match', ''), urlMatch = get('--url', '');
  const wait = parseInt(get('--wait', '20000'), 10);
  if (!urlMatch) { console.error('usage: cdp-reqdiff.js --url <substring of the API to capture> [--match <page host>] [--mine mine.json] [--port 9222] [--wait 20000]'); process.exit(2); }
  let CDP; try { CDP = require('chrome-remote-interface'); } catch (e) { console.error('[reqdiff] needs chrome-remote-interface'); process.exit(1); }

  const targets = await CDP.List({ host, port });
  const pages = targets.filter((t) => t.type === 'page' && !/^devtools:|^chrome:/.test(t.url));
  const target = (match && pages.find((p) => p.url.includes(match))) || pages.find((p) => /^https?:/.test(p.url)) || pages[0];
  if (!target) { console.error('[reqdiff] no usable page target'); process.exit(1); }
  const client = await CDP({ host, port, target: target.id });
  const { Network } = client; await Network.enable();

  const reqHdr = {}, urlOf = {};
  Network.requestWillBeSent((e) => { if (e.request.url.includes(urlMatch)) { reqHdr[e.requestId] = e.request.headers || {}; urlOf[e.requestId] = e.request.url; } });
  const extra = {};
  Network.requestWillBeSentExtraInfo((e) => { if (e.headers && (e.headers.Cookie || e.headers.cookie)) extra[e.requestId] = e.headers; });

  console.error(`[reqdiff] target=${target.url}\n[reqdiff] waiting up to ${wait/1000}s for a request whose URL contains "${urlMatch}" (drive the page to trigger it)…`);
  const start = Date.now();
  let cap = null;
  while (Date.now() - start < wait) {
    await new Promise((r) => setTimeout(r, 500));
    const id = Object.keys(reqHdr).find((i) => extra[i]);
    if (id) { const h = reqHdr[id], ex = extra[id] || {}; cap = { method: 'GET', url: urlOf[id], headers: h, cookies: parseCookies(ex.Cookie || ex.cookie || h.Cookie || h.cookie) }; break; }
  }
  if (!cap) { console.error('[reqdiff] no matching request captured (was it triggered? cookies may be httpOnly-only).'); await client.close(); process.exit(1); }

  console.log('\n=== BROWSER request (the working one) ===');
  console.log('  url:', cap.url.slice(0, 100));
  const authHdrs = Object.keys(cap.headers).filter((k) => /zp|token|trace|sign|sec-ch|x-/i.test(k));
  console.log('  app/auth headers:', JSON.stringify(authHdrs.reduce((o, k) => (o[k] = String(cap.headers[k]).slice(0, 30), o), {})));
  console.log('  cookies:', Object.keys(cap.cookies).join(', '));
  const flags = encodingFlags(cap.cookies);
  if (flags.length) { console.log('  ⚠️ ENCODING-SENSITIVE cookies (match the browser exactly):'); flags.forEach((f) => console.log('     - ' + f.cookie + ': ' + f.note + '  (…' + f.rawTail + ')')); }

  const mineFile = get('--mine', null);
  if (mineFile && fs.existsSync(mineFile)) {
    const mine = JSON.parse(fs.readFileSync(mineFile, 'utf8'));
    const d = diffRequests(cap, mine);
    console.log('\n=== DIFF vs your replay (' + mineFile + ') ===');
    console.log('  missing auth headers:', d.missingHeaders.length ? d.missingHeaders.join(', ') : '(none)');
    if (d.headerValueDiffs.length) console.log('  header value diffs:', JSON.stringify(d.headerValueDiffs));
    if (d.cookieDiffs.length) { console.log('  cookie diffs:'); d.cookieDiffs.forEach((c) => console.log('     - ' + c.cookie + ': ' + c.issue + (c.browserTail ? ' (browser …' + c.browserTail + (c.mineTail ? ' / mine …' + c.mineTail : '') + ')' : ''))); }
    else console.log('  cookies: no diffs');
    console.log('\n  → fix whatever is flagged above (most commonly: URL-encode a cookie value to match the browser).');
  } else {
    console.log('\n(no --mine file given — pass {method,headers,cookies} of your replay to auto-diff.)');
  }
  await client.close();
}

module.exports = { parseCookies, encodingFlags, diffRequests, run };
if (require.main === module) run(process.argv.slice(2)).catch((e) => { console.error('[reqdiff] error:', e.message); process.exit(1); });
