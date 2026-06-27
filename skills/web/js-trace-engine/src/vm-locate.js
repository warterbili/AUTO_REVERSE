'use strict';
// vm-locate.js — find the dispatch loop(s) of a JSVMP / control-flow-flattened function.
//
// Signature (learned from Boss zhipin's zpAegis token VM): a LOOP (any form — `for(;;)`,
// `for(;p!==void 0;)`, `while`, `do`) whose body contains a SWITCH (or ternary/if chain `N===x`)
// whose discriminant — OR a var it derives from — is REASSIGNED inside the loop. Case-count and
// `while(true)` are NOT required. The state var is resolved via the LOOP CONDITION first
// (Boss: `for(;p!==void 0;)` → packed state `p`, bit-sliced into `31 & p` discriminants).
//
// Emits ONE dispatcher PER dispatch-loop (a function can hold several independent state machines).

const babel = require('@babel/core');
const t = babel.types;

function idsIn(node) {
  const out = new Set();
  if (!node) return out;
  babel.traverse(t.file(t.program([t.expressionStatement(t.cloneNode(node, true))])), { Identifier(p) { out.add(p.node.name); } });
  return out;
}
function srcOf(node) {
  try { return babel.transformFromAstSync(t.file(t.program([t.expressionStatement(t.cloneNode(node, true))])), null, { code: true, configFile: false, babelrc: false }).code.replace(/;\s*$/, ''); }
  catch (e) { return '<expr>'; }
}
function addDerive(map, name, sources) { if (!map.has(name)) map.set(name, new Set()); for (const s of sources) if (s !== name) map.get(name).add(s); }

function analyzeFunction(path) {
  const loopAssigned = new Set();
  const derive = new Map();
  const incremented = new Set(), indexUse = new Map();
  const switchRecs = [];                 // {cases, discriminant, loopNode, condVars}
  const ifByLoop = new Map();            // loopNode -> Map(key -> {count, node, condVars})

  // find the enclosing loop WITHIN this function — must not cross a function boundary (a switch in
  // a nested case-handler function is NOT a dispatcher of the outer loop).
  const enclosingLoop = (p) => {
    let cur = p.parentPath;
    while (cur) {
      if (cur.isFunction()) return null;
      if (cur.isWhile() || cur.isForStatement() || cur.isDoWhileStatement() || cur.isForOfStatement() || cur.isForInStatement()) return cur;
      cur = cur.parentPath;
    }
    return null;
  };
  const condVarsOf = (loop) => {
    if (!loop) return new Set();
    const test = loop.isForStatement() ? loop.node.test : (loop.isForOfStatement() || loop.isForInStatement()) ? loop.node.right : loop.node.test;
    return idsIn(test);
  };
  const noteAssign = (name, p) => { if (enclosingLoop(p)) loopAssigned.add(name); };

  path.traverse({
    Function(p) { p.skip(); },
    AssignmentExpression(p) {
      if (t.isIdentifier(p.node.left)) { noteAssign(p.node.left.name, p); if (p.node.operator === '=') addDerive(derive, p.node.left.name, idsIn(p.node.right)); }
    },
    UpdateExpression(p) { if (t.isIdentifier(p.node.argument)) { incremented.add(p.node.argument.name); noteAssign(p.node.argument.name, p); } },
    VariableDeclarator(p) { if (t.isIdentifier(p.node.id) && p.node.init) { noteAssign(p.node.id.name, p); addDerive(derive, p.node.id.name, idsIn(p.node.init)); } },
    MemberExpression(p) { if (p.node.computed && t.isIdentifier(p.node.property)) indexUse.set(p.node.property.name, (indexUse.get(p.node.property.name) || 0) + 1); },
    SwitchStatement(p) { const loop = enclosingLoop(p); if (!loop) return; switchRecs.push({ cases: p.node.cases.length, discriminant: p.node.discriminant, loopNode: loop.node, condVars: condVarsOf(loop) }); },
    BinaryExpression(p) {
      const { operator, left, right } = p.node;
      if (operator !== '===' && operator !== '==') return;
      let disc = null;
      if (t.isNumericLiteral(right) && !t.isNumericLiteral(left)) disc = left;
      else if (t.isNumericLiteral(left) && !t.isNumericLiteral(right)) disc = right;
      const loop = enclosingLoop(p);
      if (!disc || !loop) return;
      const key = srcOf(disc);
      let m = ifByLoop.get(loop.node); if (!m) { m = new Map(); ifByLoop.set(loop.node, m); }
      const e = m.get(key) || { count: 0, node: disc, condVars: condVarsOf(loop) }; e.count++; m.set(key, e);
    },
  });

  const sourcesOf = (name, depth = 0, seen = new Set()) => {
    if (depth > 4 || seen.has(name)) return new Set();
    seen.add(name);
    const direct = derive.get(name) || new Set();
    const all = new Set(direct);
    for (const d of direct) for (const s of sourcesOf(d, depth + 1, seen)) all.add(s);
    return all;
  };
  const stateFeeding = (discNode, condVars) => {
    const dv = idsIn(discNode);
    const reachable = new Set();
    for (const v of dv) { if (loopAssigned.has(v)) reachable.add(v); for (const s of sourcesOf(v)) if (loopAssigned.has(s)) reachable.add(s); }
    if (condVars) for (const v of reachable) if (condVars.has(v)) return v;     // loop-condition state var (Boss: p)
    for (const v of dv) if (loopAssigned.has(v)) return v;                       // discriminant itself (classic VM: op)
    for (const v of reachable) return v;
    return null;
  };

  let pcVar = null, pcScore = -1;
  for (const nm of incremented) { const s = indexUse.get(nm) || 0; if (s > pcScore && s > 0) { pcScore = s; pcVar = nm; } }

  let fnName = '<anon>';
  if (path.node.id && path.node.id.name) fnName = path.node.id.name;
  else if (t.isVariableDeclarator(path.parent) && path.parent.id && path.parent.id.name) fnName = path.parent.id.name;
  const line = path.node.loc ? path.node.loc.start.line : 0;
  const mk = (d) => ({ ...d, fnName, line, opCodeSrc: srcOf(d.opNode), opNode: t.cloneNode(d.opNode, true), stateVar: d.state, pcVar: pcVar || d.state });

  const dispatchers = [];
  // one dispatcher per loop that has a switch
  const swByLoop = new Map();
  for (const sw of switchRecs) { if (!swByLoop.has(sw.loopNode)) swByLoop.set(sw.loopNode, []); swByLoop.get(sw.loopNode).push(sw); }
  for (const [, sws] of swByLoop) {
    let best = null;
    for (const sw of sws) { const state = stateFeeding(sw.discriminant, sw.condVars); if (!state) continue; if (!best || sw.cases > best.cases) best = { kind: 'switch', score: sw.cases, cases: sw.cases, ifComparisons: 0, opNode: sw.discriminant, state }; }
    if (best) dispatchers.push(mk(best));
  }
  // if-chain loops not already covered by a switch dispatcher
  for (const [loopNode, m] of ifByLoop) {
    if (swByLoop.has(loopNode)) continue;
    let best = null;
    for (const [, e] of m) { const state = stateFeeding(e.node, e.condVars); if (!state) continue; if (!best || e.count > best.count) best = { kind: 'ifchain', score: e.count, cases: 0, ifComparisons: e.count, opNode: e.node, state }; }
    if (best) dispatchers.push(mk(best));
  }
  return dispatchers;
}

function locate(src, opts = {}) {
  const threshold = opts.threshold || 3;
  const ast = babel.parse(src, { configFile: false, babelrc: false, parserOpts: { errorRecovery: true, allowReturnOutsideFunction: true } });
  const candidates = [];
  babel.traverse(ast, { Function(path) { for (const d of analyzeFunction(path)) if (d.score >= threshold && d.opNode) candidates.push(d); } });
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

module.exports = { locate };
