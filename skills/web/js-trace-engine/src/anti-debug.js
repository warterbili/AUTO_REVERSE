'use strict';
// anti-debug.js — a Babel pre-pass that DEFEATS known anti-debug traps statically, and REPORTS
// the risky ones instead of silently mangling them.
//
// Philosophy: strip what's provably safe; report what's ambiguous (let the human/LLM decide) and
// gate aggressive neutralization behind a flag. Over-eager auto-rewriting of self-defending guards
// is how deobfuscators silently corrupt logic.
//
// Safe strips (always):
//   * `debugger;` statements
//   * the `debugger` string fed to Function-constructor traps — incl. folded concat like
//     'debu' + 'gger' — replaced with '' so `Function('debugger')()` becomes a harmless no-op
// Reported (and only neutralized with opts.aggressive):
//   * self-defending integrity guards: `<x>.toString().search(<catastrophic regex>)` /
//     `RegExp(<nested-quantifier>).test(<x>.toString())`
//   * memory bombs: `new Array(>=1e5)` and `<str>.repeat(>=1e4)` — shrunk to 1 (the densify-bomb
//     that OOMs the tab; see cases/boss-zhipin-web-antidebug detection-points Layer 3). Numeric-
//     literal sizes only, so legit small allocations are untouched.
// Reported ONLY (never auto-neutralized — neutralize via an explicit rule-pack so the human opts in,
// because blanking these can change page behavior):
//   * eject primitives: `window.open("","_self")` / `window.close()` / `history.back()`
//   * devtools probes: `<el>.__defineGetter__("id", …)` (getter fires only when DevTools inspects)
//
// Returns { code, stripped: {debuggerStmts, debuggerStrings, selfDefendingNeutralized,
//   bombsNeutralized}, findings: [{type, line, …}] }.

const babel = require('@babel/core');
const t = babel.types;

// flatten a `+` chain of string literals into a constant, else null
function foldStringConcat(node) {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isBinaryExpression(node, { operator: '+' })) {
    const l = foldStringConcat(node.left);
    const r = foldStringConcat(node.right);
    if (l != null && r != null) return l + r;
  }
  return null;
}

// crude "catastrophic backtracking" detector: ≥2 quantifiers applied right after a group close,
// i.e. nested unbounded quantifiers like (((.+)+)+)+ — the classic self-defending regex shape.
function looksCatastrophic(str) {
  if (typeof str !== 'string') return false;
  return (str.match(/\)[+*]/g) || []).length >= 2;
}

function run(src, opts = {}) {
  const ast = babel.parse(src, {
    configFile: false, babelrc: false,
    parserOpts: { errorRecovery: true, allowReturnOutsideFunction: true },
  });
  const stripped = { debuggerStmts: 0, debuggerStrings: 0, selfDefendingNeutralized: 0, bombsNeutralized: 0 };
  const findings = [];
  const lineOf = (n) => (n.loc ? n.loc.start.line : 0);
  const BOMB_ARRAY = 1e5; // new Array(>=1e5)
  const BOMB_REPEAT = 1e4; // x.repeat(>=1e4)

  babel.traverse(ast, {
    DebuggerStatement(path) { stripped.debuggerStmts++; path.remove(); },

    // memory bomb: new Array(<huge numeric literal>) — densify-bomb that OOMs the tab
    NewExpression(path) {
      const c = path.node.callee;
      if (!t.isIdentifier(c, { name: 'Array' }) || path.node.arguments.length !== 1) return;
      const a = path.node.arguments[0];
      if (t.isNumericLiteral(a) && a.value >= BOMB_ARRAY) {
        findings.push({ type: 'memory-bomb', subtype: 'Array', line: lineOf(path.node), size: a.value });
        if (opts.aggressive) { a.value = 1; stripped.bombsNeutralized++; }
      }
    },

    // 'debugger' literal or folded concat -> '' (kills Function('debugger') traps)
    'StringLiteral|BinaryExpression'(path) {
      const folded = foldStringConcat(path.node);
      if (folded === 'debugger') {
        stripped.debuggerStrings++;
        path.replaceWith(t.stringLiteral(''));
        path.skip();
      }
    },

    CallExpression(path) {
      const callee = path.node.callee;
      if (!t.isMemberExpression(callee)) return;
      const method = callee.property && (callee.property.name || callee.property.value);
      const obj = callee.object;

      // memory bomb: <str>.repeat(<huge numeric literal>) -> shrink to 1
      if (method === 'repeat' && path.node.arguments.length === 1) {
        const a = path.node.arguments[0];
        if (t.isNumericLiteral(a) && a.value >= BOMB_REPEAT) {
          findings.push({ type: 'memory-bomb', subtype: 'repeat', line: lineOf(path.node), size: a.value });
          if (opts.aggressive) { a.value = 1; stripped.bombsNeutralized++; }
        }
      }
      // eject primitives (report only): window.open("","_self") / window.close() / history.back()
      if (t.isIdentifier(obj, { name: 'window' }) && (method === 'open' || method === 'close')) {
        findings.push({ type: 'eject', subtype: 'window.' + method, line: lineOf(path.node) });
      }
      if (t.isIdentifier(obj, { name: 'history' }) && (method === 'back' || method === 'go')) {
        findings.push({ type: 'eject', subtype: 'history.' + method, line: lineOf(path.node) });
      }
      // devtools probe (report only): <el>.__defineGetter__("id"|…, fn) — getter fires on inspect
      if (method === '__defineGetter__') {
        findings.push({ type: 'devtools-probe', subtype: '__defineGetter__', line: lineOf(path.node) });
      }

      // self-defending: <x>.toString().search(<regex>)  or  RegExp(<regex>).test(<x>.toString())
      if (method !== 'search' && method !== 'test') return;

      // gather the regex string argument (and the NODE holding it, so we can defang in place)
      let regexStr = null, regexNode = null;
      const arg0 = path.node.arguments[0];
      if (arg0) { const f = foldStringConcat(arg0); if (f != null) { regexStr = f; regexNode = arg0; } else if (t.isRegExpLiteral(arg0)) { regexStr = arg0.pattern; regexNode = arg0; } }
      // also handle RegExp(<str>).test(<x>.toString())
      if (regexStr == null && t.isCallExpression(callee.object) && t.isIdentifier(callee.object.callee, { name: 'RegExp' })) {
        const ra = callee.object.arguments[0];
        const f = ra ? foldStringConcat(ra) : null;
        if (f != null) { regexStr = f; regexNode = ra; }
      }
      const subjectMentionsToString = /toString/.test(babel.transformFromAstSync(t.file(t.program([t.expressionStatement(t.cloneNode(callee.object, true))])), null, { code: true, configFile: false, babelrc: false }).code);

      if (looksCatastrophic(regexStr) || (subjectMentionsToString && (method === 'test' || method === 'search'))) {
        findings.push({ type: 'self-defending', line: lineOf(path.node), regex: regexStr ? String(regexStr).slice(0, 40) : null });
        if (opts.aggressive && regexNode) {
          // DEFANG the regex (the actual weapon is catastrophic backtracking on reformatted code),
          // do NOT substitute the boolean result — that would blindly flip branch polarity.
          stripped.selfDefendingNeutralized++;
          if (t.isRegExpLiteral(regexNode)) { regexNode.pattern = 'x'; }
          else { regexNode.value = 'x'; }
        }
      }
    },
  });

  const out = babel.transformFromAstSync(ast, null, { code: true, configFile: false, babelrc: false, compact: false });
  return { code: out.code, stripped, findings };
}

module.exports = { run };
