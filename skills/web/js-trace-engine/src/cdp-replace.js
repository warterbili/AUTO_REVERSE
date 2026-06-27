'use strict';
// Mode-C — live SOURCE REPLACEMENT in a real Chrome via CDP, the way that actually survives real
// targets. Two transforms are available and composable per request:
//   * rule-pack patches (--rules <preset|file>)  — surgical, name-stable anti-debug neutralization
//   * anti-debug AST pass (--anti-debug)          — debugger/self-defending/memory-bomb defang
//   * full L1 instrumentation (--instrument)      — probe every statement (tracing, not bypass)
//
//   node src/cdp-replace.js --url https://target --port 9222 \
//        [--rules boss] [--anti-debug] [--instrument] [--match '*static.zhipin.com*.js*'] \
//        [--no-inject] [--strip-sri] [--wait 9000] [--out jt-out]
//
// TRANSPORT (the lesson from cases/boss-zhipin-web-antidebug):
//   * DO NOT push a big body through `Fetch.fulfillRequest` — a 791 KB bundle OOMs CDP. Instead run
//     a tiny LOCAL HTTP server that re-fetches the origin URL, transforms it, caches by URL, and
//     serves it; at REQUEST stage redirect the page's JS request to the local server via
//     `Fetch.continueRequest({url})`. The CDP message then carries only a small URL.
//   * `Network.setCacheDisabled(true)` — else the bundle loads from disk cache and bypasses Fetch
//     (a silent no-op that looks like "patched" but isn't).
//   * `--no-inject` — pure file replacement, ZERO `addScriptToEvaluateOnNewDocument`. Runtime
//     injection that overrides Array/rAF/timing/native methods BREAKS SPA frameworks (clicks die)
//     and trips native-method-tamper detectors (method_modify -> server flag -> redirect). Source
//     replacement touches neither. Inject the L2 prelude ONLY when you explicitly want tracing.
//
// Needs `chrome-remote-interface` + Chrome started with --remote-debugging-port. Node 18+ (global
// fetch). The body-transform (transformJs / stripSri) is pure + unit-tested without Chrome.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { instrumentCode } = require('./instrument');
const antidebug = require('./anti-debug');
const { applyRules, loadRules } = require('./rule-packs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- pure, testable transforms -----------------------------------------------
function transformJs(src, opts = {}) {
  let code = src;
  let stripped = null;
  const ruleHits = [];
  if (opts.rules && opts.rules.length) { const r = applyRules(code, opts.rules); code = r.code; ruleHits.push(...r.hits); }
  if (opts.antiDebug) { const r = antidebug.run(code, { aggressive: true }); code = r.code; stripped = r.stripped; }
  if (opts.instrument) { code = instrumentCode(code, { members: !!opts.members }).code; }
  return { code, stripped, ruleHits };
}

function stripSri(html) {
  let n = 0;
  const out = html
    .replace(/\s+integrity=("[^"]*"|'[^']*')/gi, () => { n++; return ''; })
    .replace(/\s+nonce=("[^"]*"|'[^']*')/gi, '');
  return { html: out, removed: n };
}

// glob-ish '*foo*.js*' -> RegExp
function matchToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$', 'i');
}

// --- CDP driver (needs Chrome) -----------------------------------------------
async function run(argv) {
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const url = get('--url');
  if (!url) {
    console.error('usage: cdp-replace.js --url <url> [--port 9222] [--rules boss|web-antidebug|file] [--anti-debug] [--instrument] [--match "*.js*"] [--no-inject] [--strip-sri] [--freeze-clock] [--out dir] [--wait 9000] [--server-port 8099]');
    process.exit(2);
  }
  const outDir = get('--out', 'jt-out');
  fs.mkdirSync(outDir, { recursive: true });
  const matchRe = matchToRegExp(get('--match', '*.js*'));
  const wait = parseInt(get('--wait', '9000'), 10);
  const serverPort = parseInt(get('--server-port', '8099'), 10);
  const host = get('--host', '127.0.0.1');
  const noInject = argv.includes('--no-inject');
  const stripSriOn = argv.includes('--strip-sri');

  const rules = loadRules(get('--rules', null));
  // default: if no transform requested, run the anti-debug pass (a sane "make it debuggable" default)
  const wantInstrument = argv.includes('--instrument');
  const wantAntiDebug = argv.includes('--anti-debug') || (!rules && !wantInstrument);
  const opts = { antiDebug: wantAntiDebug, instrument: wantInstrument, members: argv.includes('--members'), rules };
  console.error(`[cdp-replace] transforms: rules=${rules ? get('--rules') + '(' + rules.length + ')' : 'none'} anti-debug=${opts.antiDebug} instrument=${opts.instrument} inject-prelude=${!noInject}`);

  let CDP;
  try { CDP = require('chrome-remote-interface'); }
  catch (e) { console.error('[cdp-replace] needs: npm i chrome-remote-interface (+ Chrome --remote-debugging-port)'); process.exit(1); }

  // ---- local transform-and-serve proxy (avoids fulfillRequest OOM) ----
  const cache = {};
  const aggHits = {}; // note -> total count across bundles
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x').searchParams.get('u');
    try {
      if (!cache[u]) {
        const r = await fetch(u, { headers: { 'user-agent': UA, referer: new URL(u).origin + '/' } });
        const body = await r.text();
        const tr = transformJs(body, opts);
        cache[u] = tr.code;
        const hitStr = (tr.ruleHits || []).filter((h) => h.count).map((h) => h.note + '×' + h.count).join(', ');
        (tr.ruleHits || []).forEach((h) => { if (h.count) aggHits[h.note] = (aggHits[h.note] || 0) + h.count; });
        const bombs = tr.stripped ? tr.stripped.bombsNeutralized : 0;
        console.error(`[patch] ${u.split('/').pop().slice(0, 44)}  ${body.length}->${tr.code.length}` + (hitStr ? '  rules:[' + hitStr + ']' : '') + (bombs ? '  bombs:' + bombs : ''));
      }
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(cache[u]);
    } catch (e) { res.writeHead(502); res.end('//proxy err ' + e.message); }
  });
  await new Promise((r) => server.listen(serverPort, '127.0.0.1', r));
  console.error(`[cdp-replace] local transform proxy on :${serverPort}`);

  const client = await CDP({ host, port: parseInt(get('--port', '9222'), 10) });
  const { Page, Network, Fetch, Runtime } = client;
  await Page.enable();
  await Runtime.enable();
  await Network.enable();
  await Network.setCacheDisabled({ cacheDisabled: true }); // else cached bundles bypass the patch

  if (!noInject) {
    const preludeBundle = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');
    const injected = `(function(){var module={exports:{}},exports=module.exports;${preludeBundle}
      window.__instrument=function(s){return s;};module.exports.installPrelude(window,${JSON.stringify({ freezeClock: argv.includes('--freeze-clock'), members: opts.members })});})();`;
    await Page.addScriptToEvaluateOnNewDocument({ source: injected });
    console.error('[cdp-replace] L2 prelude injected (use --no-inject for pure file replacement)');
  }

  const patterns = [{ urlPattern: '*', requestStage: 'Request' }];
  if (stripSriOn) patterns.push({ urlPattern: '*', requestStage: 'Response' });
  await Fetch.enable({ patterns });

  Fetch.requestPaused(async (ev) => {
    const id = ev.requestId;
    const atResponse = ev.responseStatusCode != null || (ev.responseHeaders && ev.responseHeaders.length > 0);
    try {
      if (!atResponse) {
        // REQUEST stage: redirect matching JS (not already-local) to the transform proxy
        const u = ev.request.url;
        const isJs = matchRe.test(u) || /\.js(\?|$)/.test(u);
        if (isJs && !u.includes('127.0.0.1:' + serverPort)) {
          await Fetch.continueRequest({ requestId: id, url: `http://127.0.0.1:${serverPort}/?u=` + encodeURIComponent(u) });
        } else {
          await Fetch.continueRequest({ requestId: id });
        }
        return;
      }
      // RESPONSE stage (only when --strip-sri): strip SRI/CSP from the HTML document (small body)
      const ct = (ev.responseHeaders || []).find((h) => /content-type/i.test(h.name));
      if (!/text\/html/i.test((ct && ct.value) || '')) { await Fetch.continueRequest({ requestId: id }); return; }
      const body = await Fetch.getResponseBody({ requestId: id });
      const raw = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      const s = stripSri(raw);
      await Fetch.fulfillRequest({
        requestId: id, responseCode: 200,
        responseHeaders: (ev.responseHeaders || []).filter((h) => !/content-length|content-security-policy/i.test(h.name)),
        body: Buffer.from(s.html).toString('base64'),
      });
      console.error(`[cdp-replace] stripped-sri(${s.removed}): ${ev.request.url.slice(0, 70)}`);
    } catch (e) { try { await Fetch.continueRequest({ requestId: id }); } catch (_) {} }
  });

  await Page.navigate({ url });
  await new Promise((r) => setTimeout(r, wait));

  let diag = '(eval failed)';
  try { diag = (await Runtime.evaluate({ expression: 'JSON.stringify({href:location.href,title:document.title,bodyLen:document.body?document.body.innerHTML.length:-1})', returnByValue: true })).result.value; } catch (e) { diag = '(' + e.message + ')'; }
  console.error('[cdp-replace] diag: ' + diag);
  const agg = Object.entries(aggHits).map(([n, c]) => n + '×' + c).join(', ');
  console.error('[cdp-replace] total rule hits: ' + (agg || 'none'));
  if (opts.instrument) {
    try {
      const res = await Runtime.evaluate({ expression: 'JSON.stringify(window.__T?window.__T._dump():{events:[],total:0,dropped:0})', returnByValue: true });
      fs.writeFileSync(path.join(outDir, 'trace.json'), res.result.value);
      console.error('[cdp-replace] trace -> ' + path.join(outDir, 'trace.json'));
    } catch (e) {}
  }
  console.error('ARMED — proxy + Fetch stay alive; the page keeps re-fetching through the patch on SPA navigation. Ctrl-C to stop.');
  await new Promise(() => {}); // stay alive so SPA route changes keep getting patched
}

module.exports = { transformJs, stripSri, matchToRegExp, run };
if (require.main === module) run(process.argv.slice(2)).catch((e) => { console.error('[cdp-replace] error:', e.message); process.exit(1); });
