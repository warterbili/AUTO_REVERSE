'use strict';
// rule-packs.js — named sets of SOURCE-LEVEL neutralization patches for live file-replacement
// (Mode-C). Each rule is { re: RegExp(global), to: string, note }. Applied as raw string replace
// BEFORE (or instead of) AST instrumentation, so they survive heavy minification where matching by
// identifier name in an AST is impossible.
//
// Philosophy (mirrors anti-debug.js):
//   * prefer surgical, NAME-STABLE shapes (shared class-method names, structural tuples) over
//     per-bundle minified identifiers — one pack then covers every bundle of a target;
//   * NEVER flip a detector's boolean result (flipping `if(n&&i&&a&&o)`->`if(false)` routes into the
//     PUNISHMENT branch = memory bomb) — blank the whole detector function instead (`fn(){return;`);
//   * never touch legit business calls — clear-flood rules match wrapper DEFINITIONS only, not bare
//     `X.clear()` statements.
//
// Driven by cases/boss-zhipin-web-antidebug (multi-bundle, XCID/XCIT shared across SEO+SPA builds).

// generic, name-independent — safe on most webpack anti-debug bundles
const WEB_ANTIDEBUG = [
  { re: /new Array\(1e\d+\)/g, to: 'new Array(1)', note: 'memory-bomb: huge Array(.fill) alloc' },
  { re: /\.repeat\(1e\d+\)/g, to: '.repeat(1)', note: 'memory-bomb: huge String.repeat' },
  // console.clear flood wrappers — 4 shapes. Wrapper DEFINITIONS only, never bare X.clear() calls.
  { re: /\(\)=>\w+\.clear\(\)/g, to: '()=>{}', note: 'console.clear wrapper (arrow)' },
  { re: /function\(\)\{return \w+\.clear\(\)\}/g, to: 'function(){}', note: 'console.clear wrapper (fn)' },
  { re: /(\.table,\w+=)\w+\.clear\b/g, to: '$1function(){}', note: 'console.clear wrapper (else-branch assign)' },
  { re: /(\.table),\w+\.clear\)/g, to: '$1,function(){})', note: 'console.clear wrapper (comma-expr tail)' },
];

// Boss zhipin — extends web-antidebug with the bundle's NAMED detectors. XCID/XCIT keep their names
// across SEO (transpiled) and SPA (ES6) builds; Bm eject + Rm native-tamper live in the SEO build.
const BOSS = [
  ...WEB_ANTIDEBUG,
  { re: /key:"XCID",value:function\(\)\{/g, to: 'key:"XCID",value:function(){return;', note: 'XCID devtools detect + flood (transpiled)' },
  { re: /key:"XCIT",value:function\(\)\{/g, to: 'key:"XCIT",value:function(){return;', note: 'XCIT probe setup (transpiled)' },
  { re: /\bXCID\(\)\{/g, to: 'XCID(){return;', note: 'XCID (ES6 class method)' },
  { re: /\bXCIT\(\)\{/g, to: 'XCIT(){return;', note: 'XCIT (ES6 class method)' },
  { re: /function Bm\(\)\{/g, to: 'function Bm(){return;', note: 'Bm eject (open/close/history.back/blur/bomb)' },
  { re: /function Rm\(\)\{/g, to: 'function Rm(){return;', note: 'Rm native-method-tamper detector' },
  // Second tamper detector — `function t(){if(Sign.encryptPwd(),…)` detonates OOM on a password-signature
  // mismatch. Ported from the production BossZhipin_reverse framework (sites/boss/patches.py, verified
  // there); anchored on `Sign.encryptPwd` so it can't hit any other `function t`. Insert `return;` before
  // the check (equivalent to that framework's body-empty). This was the missing patch behind main.js=29-vs-30.
  { re: /(function t\(\)\{)(if\(Sign\.encryptPwd)/g, to: '$1return;$2', note: 'function-t: Sign.encryptPwd tamper detector → blank' },
  // Layer 6 — Ef keyboard-shortcut detector. Force the keyCode tests const-false so the handler
  // stops preventDefault-ing DevTools shortcuts (the `if` guard never fires). Shape-based (the I/J/F12
  // keyCodes are the invariant), NOT identifier-based — `\w+` absorbs the minified keyCode var.
  // Scoped to BOSS (not WEB_ANTIDEBUG) so it can't clobber a site's legit I/J/F12 key handlers.
  { re: /\(73===\w+\|\|74===\w+\)/g, to: '(!1)', note: 'Ef: Ctrl/Cmd+Shift+I/J shortcut → const-false' },
  { re: /\b123===\w+/g, to: '!1', note: 'Ef: F12 (keyCode 123) shortcut → const-false' },
  // Layer 7 — timing/frame-gap detector (`__defineSetter__` probe gated on `Xm<535`). Short-circuit
  // the guard to const-true so the probe-rearm/flag branch (`||(...)`) never runs. The 535 threshold
  // is the stable signature; `\w+` absorbs the minified elapsed-time var.
  { re: /\w+&&\w+<535/g, to: '!0', note: 'timing: __defineSetter__ frame-gap (<535) guard → const-true' },
];

const PACKS = { 'web-antidebug': WEB_ANTIDEBUG, boss: BOSS };

// apply a rule array to source; returns { code, hits:[{note,count}], total }
function applyRules(code, rules) {
  const hits = [];
  let total = 0;
  for (const r of rules) {
    const m = code.match(r.re);
    const n = m ? m.length : 0;
    if (n) { code = code.replace(r.re, r.to); total += n; }
    hits.push({ note: r.note, count: n });
  }
  return { code, hits, total };
}

// resolve a --rules value: a preset NAME, a .json file (array of {re,to,note}; re is a string +
// optional flags), or a .js module exporting an array of {re,to,note}.
function loadRules(spec) {
  if (!spec) return null;
  if (PACKS[spec]) return PACKS[spec];
  const fs = require('fs');
  const path = require('path');
  const p = path.resolve(spec);
  if (!fs.existsSync(p)) {
    throw new Error('unknown rule pack "' + spec + '" (presets: ' + Object.keys(PACKS).join(', ') + ', or pass a .json/.js path)');
  }
  if (p.endsWith('.json')) {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw.map((r) => ({ re: new RegExp(r.re, r.flags || 'g'), to: r.to, note: r.note || r.re }));
  }
  return require(p);
}

module.exports = { PACKS, WEB_ANTIDEBUG, BOSS, applyRules, loadRules };
