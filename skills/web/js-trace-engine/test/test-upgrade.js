'use strict';
// Chrome-free self-test for the Mode-C upgrade: rule-packs, anti-debug taxonomy, transformJs,
// verify checks. Run: node test/test-upgrade.js   (exits non-zero on any failure)
const assert = require('assert');
const { PACKS, applyRules, loadRules } = require('../src/rule-packs');
const antidebug = require('../src/anti-debug');
const { transformJs, matchToRegExp } = require('../src/cdp-replace');
const { evaluateChecks } = require('../src/cdp-verify');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  [PASS] ' + name); } catch (e) { console.error('  [FAIL] ' + name + ' :: ' + e.message); process.exitCode = 1; } };

// ---- rule-packs: the real Boss shapes (from cases/boss-zhipin-web-antidebug) ----
ok('boss pack neutralizes the console.clear comma-tail (main.js shape)', () => {
  const src = '...apply(pg,arguments)},function(){return pg.clear()}):(_f=pg.log,Df=pg.table,pg.clear)';
  const { code, total } = applyRules(src, PACKS.boss);
  assert(/Df=pg\.table,function\(\)\{\}\)/.test(code), 'comma-tail not neutralized: ' + code);
  assert(!/return pg\.clear\(\)/.test(code), 'IE fn wrapper not neutralized');
  assert(total >= 2, 'expected >=2 hits, got ' + total);
});
ok('boss pack neutralizes vendor-1 arrow + else clear shapes', () => {
  const src = 'o=(...e)=>t.log(...e),i=(...e)=>t.table(...e),a=()=>t.clear()):(o=t.log,i=t.table,a=t.clear)';
  const { code } = applyRules(src, PACKS.boss);
  assert(/a=\(\)=>\{\}/.test(code), 'arrow wrapper not neutralized: ' + code);
  assert(/i=t\.table,a=function\(\)\{\}/.test(code), 'else-branch assign not neutralized: ' + code);
});
ok('boss pack does NOT touch legit business .clear() calls', () => {
  const src = 'i.hide(),i.clear(),n.preventDefault();mapInstance.clear();Sign.clear()';
  const { code, total } = applyRules(src, PACKS.boss);
  assert(code === src, 'legit clear() calls were mangled: ' + code);
  assert(total === 0);
});
ok('boss pack blanks XCID/XCIT (both syntaxes) + Bm/Rm, never flips a gate', () => {
  const src = 'XCID(){this.probe()} key:"XCIT",value:function(){flood()} function Bm(){eject()} function Rm(){detect()}';
  const { code } = applyRules(src, PACKS.boss);
  assert(/XCID\(\)\{return;/.test(code), 'ES6 XCID not blanked');
  assert(/key:"XCIT",value:function\(\)\{return;/.test(code), 'transpiled XCIT not blanked');
  assert(/function Bm\(\)\{return;/.test(code) && /function Rm\(\)\{return;/.test(code), 'Bm/Rm not blanked');
  assert(!/if\(false\)/.test(code), 'must never introduce if(false) gate flips');
});
ok('boss pack defuses memory bombs', () => {
  const src = 'new Array(1e4).fill("x"); "x".repeat(1e4); window[n]=new Array(1e9)';
  const { code } = applyRules(src, PACKS.boss);
  assert(!/1e4|1e9/.test(code), 'bombs not defused: ' + code);
  assert(/new Array\(1\)/.test(code) && /\.repeat\(1\)/.test(code));
});
ok('loadRules resolves preset names and rejects unknown', () => {
  assert.strictEqual(loadRules('boss'), PACKS.boss);
  assert.strictEqual(loadRules('web-antidebug'), PACKS['web-antidebug']);
  assert.throws(() => loadRules('nope-not-a-pack'));
});

// ---- anti-debug AST taxonomy ----
ok('anti-debug aggressive shrinks new Array(>=1e5) and repeat(>=1e4)', () => {
  const r = antidebug.run('var a=new Array(1e9); var s="x".repeat(1e4); var ok=new Array(10);', { aggressive: true });
  assert(/new Array\(1\)/.test(r.code), 'Array bomb not shrunk');
  assert(/\.repeat\(1\)/.test(r.code), 'repeat bomb not shrunk');
  assert(/new Array\(10\)/.test(r.code), 'legit small Array(10) must be left alone');
  assert(r.stripped.bombsNeutralized === 2, 'expected 2 bombs, got ' + r.stripped.bombsNeutralized);
});
ok('anti-debug reports eject + devtools-probe (report-only, not mutated)', () => {
  const r = antidebug.run('window.open("","_self"); window.close(); history.back(); el.__defineGetter__("id",f);', { aggressive: true });
  const types = r.findings.map((f) => f.type + ':' + (f.subtype || ''));
  assert(types.includes('eject:window.open'), 'missing window.open: ' + types);
  assert(types.includes('eject:window.close'));
  assert(types.includes('eject:history.back'));
  assert(types.includes('devtools-probe:__defineGetter__'));
  assert(/window\.open/.test(r.code), 'eject must be reported, NOT removed');
});
ok('anti-debug still strips debugger + Function("debugger")', () => {
  const r = antidebug.run('debugger; Function("debu"+"gger")();', { aggressive: true });
  assert(!/debugger/.test(r.code.replace(/debuggerStmts/g, '')), 'debugger survived: ' + r.code);
  assert(r.stripped.debuggerStmts === 1);
});

// ---- transformJs composition + match glob ----
ok('transformJs applies rules without instrumentation by default (patch mode)', () => {
  const out = transformJs('function Bm(){eject()} new Array(1e9)', { rules: PACKS.boss, antiDebug: false, instrument: false });
  assert(/function Bm\(\)\{return;/.test(out.code));
  assert(/new Array\(1\)/.test(out.code));
  assert(out.code.length < 120, 'patch mode must not bloat (no instrumentation)');
});
ok('matchToRegExp turns globs into anchored regexes', () => {
  assert(matchToRegExp('*static.zhipin.com*.js*').test('https://static.zhipin.com/x/vendor-1.b980027c.js'));
  assert(!matchToRegExp('*vendor*').test('https://x/main.js'));
});

// ---- verify checks (pure) ----
ok('evaluateChecks PASS on a clean snapshot', () => {
  const checks = evaluateChecks({ clear: 0, flood: 0, href: 'https://x/web/geek/jobs', start: 'https://x/web/geek/jobs', filter: 'none', display: 'block', bodyLen: 85000, sel: 17 });
  assert(checks.every((c) => c.pass), 'clean snapshot should pass: ' + JSON.stringify(checks.filter((c) => !c.pass)));
});
ok('evaluateChecks FAILs on flood/clear/redirect/blur', () => {
  const checks = evaluateChecks({ clear: 9, flood: 50, href: 'https://x/', start: 'https://x/web/geek/jobs', filter: 'blur(20px)', display: 'block', bodyLen: 900, sel: 0 });
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);
  ['no console.clear flood', 'no console flood', 'no redirect-to-home', 'body not blurred/hidden by overlay', 'page rendered', 'target elements present'].forEach((n) => assert(failed.includes(n), 'should fail: ' + n));
});

// ---- reqdiff: the "browser works, replay doesn't" diff (the encoding saga, as a tool) ----
const { parseCookies, encodingFlags, diffRequests } = require('../src/cdp-reqdiff');
ok('reqdiff parseCookies splits a Cookie header', () => {
  const c = parseCookies('a=1; __zp_stoken__=71f3g%2Fx; b=2');
  assert.strictEqual(c.a, '1'); assert.strictEqual(c.b, '2'); assert.strictEqual(c['__zp_stoken__'], '71f3g%2Fx');
});
ok('reqdiff encodingFlags flags a URL-encoded cookie AND a risky-raw token', () => {
  const f = encodingFlags({ enc: '71f3g%2Fx%2By', raw: '71f3g/x+y', plain: 'abc123' });
  const names = f.map((x) => x.cookie);
  assert(names.includes('enc'), 'should flag the %-encoded cookie');
  assert(names.includes('raw'), 'should flag the raw +,/ token');
  assert(!names.includes('plain'), 'plain alnum cookie must not be flagged');
});
ok('reqdiff diffRequests catches ENCODING-only cookie difference (the Boss bug)', () => {
  const browser = { headers: { 'zp_token': 'V2..' }, cookies: { __zp_stoken__: '71f3gX%2FY%2Bz' } };
  const mine = { headers: {}, cookies: { __zp_stoken__: '71f3gX/Y+z' } }; // same token, RAW
  const d = diffRequests(browser, mine);
  assert(d.missingHeaders.includes('zp_token'), 'should flag missing zp_token header');
  const ck = d.cookieDiffs.find((c) => c.cookie === '__zp_stoken__');
  assert(ck && /ENCODING differs/.test(ck.issue), 'should detect same-value-different-encoding: ' + JSON.stringify(ck));
});
ok('reqdiff diffRequests flags a missing cookie and a genuinely different value', () => {
  const d = diffRequests({ headers: {}, cookies: { a: 'x', b: 'p' } }, { headers: {}, cookies: { a: 'x', b: 'q' } });
  const b = d.cookieDiffs.find((c) => c.cookie === 'b');
  assert(b && /value differs/.test(b.issue));
});

console.log('\n' + pass + ' checks passed' + (process.exitCode ? ' (with FAILURES above)' : ''));
