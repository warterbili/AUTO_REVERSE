// Pure FILE REPLACEMENT for EVERY Boss JS bundle (main.js SEO + vendor-* / vendors~app SPA + chunks).
// No runtime injection (so the SPA framework's Array/rAF/timing stay intact -> clicks keep working).
// A local proxy fetches each requested bundle, applies name-stable universal patches, and serves it.
const CDP = require('chrome-remote-interface');
const http = require('http');
const TARGET = process.argv[2] || 'https://www.zhipin.com/';
const PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// universal patches — cover BOTH syntaxes (ES6 class `XCID(){}` AND transpiled `key:"XCID",value:function(){}`)
const PATCHES = [
  [/key:"XCID",value:function\(\)\{/g, 'key:"XCID",value:function(){return;'], // main.js detector+flood (transpiled)
  [/key:"XCIT",value:function\(\)\{/g, 'key:"XCIT",value:function(){return;'],
  [/\bXCID\(\)\{/g, 'XCID(){return;'],   // vendor-* detector+flood (ES6 class method)
  [/\bXCIT\(\)\{/g, 'XCIT(){return;'],   // vendor-* probe setup (createElement div + console.log)
  [/function Bm\(\)\{/g, 'function Bm(){return;'], // main.js eject
  [/function Rm\(\)\{/g, 'function Rm(){return;'], // main.js native-tamper detector
  [/(function t\(\)\{)(if\(Sign\.encryptPwd)/g, '$1return;$2'], // 2nd tamper detector (Sign.encryptPwd → OOM); ported from BossZhipin_reverse
  [/\(73===\w+\|\|74===\w+\)/g, '(!1)'],           // Ef: Ctrl/Cmd+Shift+I/J shortcut -> const-false
  [/\b123===\w+/g, '!1'],                          // Ef: F12 (keyCode 123) shortcut -> const-false
  [/\w+&&\w+<535/g, '!0'],                         // timing: __defineSetter__ frame-gap (<535) -> const-true
  [/new Array\(1e\d+\)/g, 'new Array(1)'],         // memory bombs (all bundles)
  [/\.repeat\(1e\d+\)/g, '.repeat(1)'],
  // console.clear flood wrappers — kill ONLY the wrapper-definition forms (log/table/clear tuple),
  // never the legit X.clear() business calls (Sign.clear/i.clear/mapInstance.clear/removeItem).
  [/\(\)=>\w+\.clear\(\)/g, '()=>{}'],                        // vendor-1 arrow:  a=()=>t.clear()
  [/function\(\)\{return \w+\.clear\(\)\}/g, 'function(){}'], // main.js fn:      function(){return pg.clear()}
  [/(\.table,\w+=)\w+\.clear\b/g, '$1function(){}'],          // else branch:     ...table,If=pg.clear / ...table,a=t.clear
  [/(\.table),\w+\.clear\)/g, '$1,function(){})'],           // main.js non-IE comma-expr tail: (_f=pg.log,Df=pg.table,pg.clear) -> If=no-op
];
function patch(code) { let n = 0; for (const [re, r] of PATCHES) { const c = (code.match(re) || []).length; n += c; code = code.replace(re, r); } return { code, n }; }

const cache = {};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x').searchParams.get('u');
  try {
    if (!cache[u]) {
      const r = await fetch(u, { headers: { 'user-agent': UA, referer: 'https://www.zhipin.com/' } });
      const body = await r.text();
      const p = patch(body);
      cache[u] = p.code;
      console.error('[patch] ' + u.split('/').pop().slice(0, 40) + '  patches=' + p.n + '  ' + body.length + '->' + p.code.length);
    }
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(cache[u]);
  } catch (e) { res.writeHead(502); res.end('//proxy err ' + e.message); }
});

server.listen(8099, '127.0.0.1', async () => {
  console.error('[local] universal bundle-patch proxy on :8099');
  let client;
  for (let i = 0; i < 40; i++) { try { client = await CDP({ port: PORT }); break; } catch (e) { await sleep(500); } }
  if (!client) { console.error('no CDP'); process.exit(1); }
  const { Page, Network, Fetch, Runtime } = client;
  await Page.enable(); await Network.enable(); await Runtime.enable();
  await Network.setCacheDisabled({ cacheDisabled: true });
  await Fetch.enable({ patterns: [{ urlPattern: '*.js*', requestStage: 'Request' }] });
  Fetch.requestPaused(async (ev) => {
    const id = ev.requestId, u = ev.request.url;
    try {
      if (/static\.zhipin\.com\/.+\.js(\?|$)/.test(u) && !/127\.0\.0\.1/.test(u)) {
        await Fetch.continueRequest({ requestId: id, url: 'http://127.0.0.1:8099/?u=' + encodeURIComponent(u) });
      } else { await Fetch.continueRequest({ requestId: id }); }
    } catch (e) { try { await Fetch.continueRequest({ requestId: id }); } catch (_) {} }
  });
  await Page.navigate({ url: TARGET });
  await sleep(9000);
  let diag = ''; try { diag = (await Runtime.evaluate({ expression: 'JSON.stringify({href:location.href,title:document.title,bodyLen:document.body?document.body.innerHTML.length:-1})', returnByValue: true })).result.value; } catch (e) {}
  console.error('[diag] ' + diag);
  console.error('ARMED — pure file-replacement on ALL bundles, NO injection. Clicks/SPA intact. Proxy stays alive.');
  await new Promise(() => {});
});
