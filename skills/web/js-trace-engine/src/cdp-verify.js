'use strict';
// cdp-verify.js — anti-debug bypass VERIFICATION harness. The difference between "I think it
// worked" and "measured 0 clears / 17 cards / filter:none". Connects to a running Chrome, picks the
// real PAGE target (NEVER the devtools:// frontend — a footgun that makes every probe return
// undefined), instruments console.clear + console-flood counters, watches for a window, then
// asserts: no clear flood, no console flood, no redirect-to-home, body not blurred/hidden, target
// rendered. Prints a red/green table + JSON and exits non-zero if any check fails.
//
//   node src/cdp-verify.js --port 9540 [--match zhipin] [--seconds 6] [--selector "a[href*=job_detail]"]
//
// Needs chrome-remote-interface. Pure-Node `evaluateChecks` is unit-tested without Chrome.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pure: turn a measured snapshot into pass/fail checks (unit-tested)
function evaluateChecks(r, opts = {}) {
  const startPath = safePath(r.start);
  const nowPath = safePath(r.href);
  const checks = [
    { name: 'no console.clear flood', pass: r.clear === 0, detail: r.clear + ' clear() calls' },
    { name: 'no console flood', pass: r.flood === 0, detail: r.flood + ' probe logs' },
    { name: 'no redirect-to-home', pass: !(nowPath === '/' && startPath !== '/'), detail: r.href },
    { name: 'body not blurred/hidden by overlay', pass: (r.filter === 'none' || r.filter === '') && r.display !== 'none', detail: 'filter=' + r.filter + ' display=' + r.display },
    { name: 'page rendered', pass: r.bodyLen > (opts.minBody || 2000), detail: r.bodyLen + ' bytes' },
  ];
  if (r.sel != null) checks.push({ name: 'target elements present', pass: r.sel > 0, detail: r.sel + ' match(es)' });
  return checks;
}
function safePath(u) { try { return new URL(u).pathname; } catch (e) { return u || ''; } }

async function run(argv) {
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const port = parseInt(get('--port', '9222'), 10);
  const host = get('--host', '127.0.0.1');
  const match = get('--match', '');
  const seconds = parseInt(get('--seconds', '6'), 10);
  const selector = get('--selector', null);

  let CDP;
  try { CDP = require('chrome-remote-interface'); }
  catch (e) { console.error('[verify] needs: npm i chrome-remote-interface'); process.exit(1); }

  const targets = await CDP.List({ host, port });
  const pages = targets.filter((t) => t.type === 'page' && !/^devtools:/.test(t.url) && !/^chrome:/.test(t.url));
  const target = (match && pages.find((p) => p.url.includes(match))) || pages.find((p) => /^https?:/.test(p.url)) || pages[0];
  if (!target) { console.error('[verify] no usable page target (devtools frontend is excluded). match=' + JSON.stringify(match)); process.exit(1); }

  const client = await CDP({ host, port, target: target.id });
  const { Runtime } = client;
  await Runtime.enable();
  const ev = async (e) => (await Runtime.evaluate({ expression: e, returnByValue: true })).result.value;

  // install counters (do NOT actually clear, so we can count without losing logs)
  await Runtime.evaluate({
    expression: `(function(){
      if(window.__VERIFY)return; window.__VERIFY={clear:0,flood:0,start:location.href};
      try{var _oc=console.clear; console.clear=function(){window.__VERIFY.clear++;};}catch(e){}
      ['log','table','info','debug','dir'].forEach(function(m){try{
        var o=console[m]?console[m].bind(console):function(){};
        console[m]=function(){
          for(var i=0;i<arguments.length;i++){var a=arguments[i];try{
            if(a&&(a.nodeType||a instanceof Date||typeof a==='function'||(Array.isArray(a)&&a.length>=20)||a instanceof RegExp)){window.__VERIFY.flood++;break;}
          }catch(e){}}
          return o.apply(console,arguments);
        };
      }catch(e){}});
    })()`,
  });

  console.error(`[verify] target=${target.url}  watching ${seconds}s …`);
  await sleep(seconds * 1000);

  const snap = JSON.parse(await ev(`JSON.stringify({
    clear: window.__VERIFY?window.__VERIFY.clear:-1,
    flood: window.__VERIFY?window.__VERIFY.flood:-1,
    href: location.href,
    start: window.__VERIFY?window.__VERIFY.start:location.href,
    filter: getComputedStyle(document.body).filter,
    display: getComputedStyle(document.body).display,
    bodyLen: document.body?document.body.innerHTML.length:0,
    sel: ${selector ? `document.querySelectorAll(${JSON.stringify(selector)}).length` : 'null'}
  })`));

  const checks = evaluateChecks(snap, {});
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log('\n  anti-debug bypass verification — ' + target.url.slice(0, 70));
  console.log('  ' + '-'.repeat(72));
  let allPass = true;
  for (const c of checks) { allPass = allPass && c.pass; console.log('  ' + (c.pass ? '[PASS]' : '[FAIL]') + ' ' + pad(c.name, 38) + ' ' + c.detail); }
  console.log('  ' + '-'.repeat(72));
  console.log('  RESULT: ' + (allPass ? 'PASS — anti-debug neutralized' : 'FAIL — see red lines above') + '\n');
  console.error(JSON.stringify({ target: target.url, snap, checks, pass: allPass }));
  await client.close();
  process.exit(allPass ? 0 : 1);
}

module.exports = { evaluateChecks, safePath, run };
if (require.main === module) run(process.argv.slice(2)).catch((e) => { console.error('[verify] error:', e.message); process.exit(1); });
