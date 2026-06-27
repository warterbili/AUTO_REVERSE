'use strict';
// Mode-A — live injection into a REAL Chrome over CDP (the stealthy capture mode).
//
//   node src/cdp-inject.js --url https://target --port 9222 --out jt-out [--freeze-clock] [--wait 6000]
//
// Connects to a Chrome you launched with `--remote-debugging-port=9222` (see the cdp-browser
// skill), injects the L2 prelude via Page.addScriptToEvaluateOnNewDocument so the eval/Function
// hooks are installed BEFORE any page script runs (this is what beats `var e = eval` aliasing),
// navigates, lets the anti-bot collector run in a real fingerprint, then pulls __T._dump() back.
//
// Real-environment advantage: the fingerprints the collector reads are genuine, and the page is
// never reformatted on disk — so source-integrity self-checks don't fire. Recursion (re-
// instrumenting eval'd code in-page) needs @babel/standalone injected too (see --babel); without
// it, Mode-A still CAPTURES every runtime-generated code string (the dynamic code-gen layers),
// which is usually the highest-value signal.
//
// Needs the optional dep `chrome-remote-interface` (npm i chrome-remote-interface). Not runnable
// on the authoring machine (no Chrome here) — but the produced trace.json drops into aggregate.js.

const fs = require('fs');
const path = require('path');

function buildInjected(opts) {
  // wrap prelude.js (a CommonJS module) so it self-installs on window, no bundler needed
  const preludeSrc = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');
  const babelStandalone = opts.babel ? fs.readFileSync(opts.babel, 'utf8') : '';
  const instrumentSrc = opts.babel ? fs.readFileSync(path.join(__dirname, 'instrument.js'), 'utf8') : '';
  return `
(function(){
  if (window.__JT_INSTALLED) return; window.__JT_INSTALLED = true;
  var module = { exports: {} }; var exports = module.exports;
  ${preludeSrc}
  var installPrelude = module.exports.installPrelude;
  ${babelStandalone ? `
  // optional in-page re-instrumentation for true eval recursion
  try {
    ${babelStandalone}
    var __mod = { exports: {} }; (function(module, exports){ ${instrumentSrc} })(__mod, __mod.exports);
    window.__instrument = function(src, o){ try { return __mod.exports.instrumentCode(src, o).code; } catch(e){ return src; } };
  } catch(e) { window.__instrument = function(s){ return s; }; }
  ` : `window.__instrument = function(s){ return s; }; // capture-only (no in-page Babel)`}
  installPrelude(window, ${JSON.stringify({ freezeClock: !!opts.freezeClock, members: !!opts.members })});
})();`;
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const url = get('--url');
  if (!url) { console.error('usage: cdp-inject.js --url <url> [--port 9222] [--host 127.0.0.1] [--out dir] [--freeze-clock] [--babel path/babel.min.js] [--wait 6000]'); process.exit(2); }
  const port = parseInt(get('--port', '9222'), 10);
  const host = get('--host', '127.0.0.1');
  const outDir = get('--out', 'jt-out');
  const wait = parseInt(get('--wait', '6000'), 10);
  fs.mkdirSync(outDir, { recursive: true });

  let CDP;
  try { CDP = require('chrome-remote-interface'); }
  catch (e) { console.error('[cdp] needs: npm i chrome-remote-interface  (and Chrome with --remote-debugging-port=' + port + ')'); process.exit(1); }

  const injected = buildInjected({
    freezeClock: argv.includes('--freeze-clock'),
    members: argv.includes('--members'),
    babel: get('--babel', null),
  });
  fs.writeFileSync(path.join(outDir, 'injected.js'), injected);

  const client = await CDP({ host, port });
  const { Page, Runtime } = client;
  await Page.enable();
  await Runtime.enable();
  await Page.addScriptToEvaluateOnNewDocument({ source: injected }); // runs before page scripts
  console.error('[cdp] prelude armed; navigating ' + url);
  await Page.navigate({ url });
  await Page.loadEventFired();
  await new Promise((r) => setTimeout(r, wait)); // let the collector run

  const res = await Runtime.evaluate({ expression: 'JSON.stringify(window.__T ? window.__T._dump() : {events:[],total:0,dropped:0})', returnByValue: true });
  const dump = JSON.parse(res.result.value);
  fs.writeFileSync(path.join(outDir, 'trace.json'), JSON.stringify(dump));
  const dyn = dump.events.filter((e) => e.t === 'dyn').length;
  console.error(`[cdp] captured events=${dump.total} dyn-codegen=${dyn} -> ${path.join(outDir, 'trace.json')}`);
  await client.close();
}

main().catch((e) => { console.error('[cdp] error:', e.message); process.exit(1); });
