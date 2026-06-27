'use strict';
// lift.js — the LLM-analysis layer ("humanify, but trace-augmented").
//
// humanify renames obfuscated identifiers from STATIC context only. We do better: we feed the LLM
// the RUNTIME TRACE evidence too (what values a variable actually held, how often a function ran,
// what it returned, whether it produced dynamic code) — far stronger signal for naming/semantics.
//
// Design (from humanify's proven split): the LLM ONLY suggests names; Babel does the deterministic,
// scope-preserving rename. The LLM never restructures code. So a wrong suggestion is cosmetic, never
// a correctness bug.
//
// Pipeline:
//   1. extractCandidates(src)         obfuscated identifiers worth renaming (_0x…, single char, hex)
//   2. gatherEvidence(cands, trace)   attach runtime evidence per identifier from trace.json
//   3a. heuristicNames(cands)         offline baseline (no API) — names from value shape
//   3b. callModel(provider, bundle)   optional: one suggestion per identifier (claude/gpt/gemini)
//   4. applyRenames(src, map)         deterministic Babel scope.rename — the safe part
//
// `lift <source.js> --trace trace.json [--model none|claude|gpt|gemini] [--apply] [--out dir]`
//   --model none  → write analysis-bundle.json + prompt.txt (+ heuristic-renamed.js); no network.

const babel = require('@babel/core');
const t = babel.types;

const OBFUSCATED = /^(_0x[0-9a-f]+|[a-z]|[A-Z]|_+\$?|\$[a-z0-9]*|[a-z]\d+|0x[0-9a-f]+|[A-Za-z]{1,2}\d*)$/;
function isObfuscated(name) {
  return name.length <= 3 || /^_0x[0-9a-f]+$/.test(name) || /^[A-Za-z]$/.test(name) || OBFUSCATED.test(name);
}

function extractCandidates(src) {
  const ast = babel.parse(src, { configFile: false, babelrc: false, parserOpts: { errorRecovery: true, allowReturnOutsideFunction: true } });
  const cands = new Map(); // name -> {name, kind, defLine, refs}
  babel.traverse(ast, {
    'FunctionDeclaration|FunctionExpression'(path) {
      const id = path.node.id;
      if (id && isObfuscated(id.name)) bump(cands, id.name, 'function', id.loc);
    },
    VariableDeclarator(path) {
      if (t.isIdentifier(path.node.id) && isObfuscated(path.node.id.name)) {
        const kind = path.node.init && (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init)) ? 'function' : 'var';
        bump(cands, path.node.id.name, kind, path.node.id.loc);
      }
    },
  });
  // count references
  babel.traverse(ast, { Identifier(path) { const c = cands.get(path.node.name); if (c) c.refs++; } });
  return [...cands.values()];
}
function bump(map, name, kind, loc) { if (!map.has(name)) map.set(name, { name, kind, defLine: loc ? loc.start.line : 0, refs: 0 }); }

function gatherEvidence(cands, trace) {
  const ev = (trace && trace.events) || [];
  const byVar = new Map(), byFnName = new Map();
  let opcodeHist = 0;
  for (const e of ev) {
    if (e.t === 'set' || e.t === 'get') {
      const k = e.name || e.prop; if (!k) continue;
      const a = byVar.get(k) || { sets: 0, samples: [] }; a.sets++;
      if (a.samples.length < 6 && e.val) a.samples.push(e.val.v !== undefined ? e.val.v : `<${e.val.ty}>`);
      byVar.set(k, a);
    } else if (e.t === 'enter') {
      const a = byFnName.get(e.name) || { calls: 0, rets: [] }; a.calls++; byFnName.set(e.name, a);
    } else if (e.t === 'vm') { opcodeHist++; }
  }
  for (const c of cands) {
    c.evidence = {};
    const v = byVar.get(c.name); if (v) c.evidence.values = v.samples, c.evidence.assignments = v.sets;
    const f = byFnName.get(c.name); if (f) c.evidence.calls = f.calls;
  }
  return { cands, dynamicCodegen: ev.filter((e) => e.t === 'dyn').length, opcodes: opcodeHist };
}

// offline baseline: name from value shape — gives non-LLM value and is fully deterministic/testable
function heuristicNames(cands) {
  const map = {}; const used = new Set();
  const uniq = (base) => { let n = base, i = 2; while (used.has(n)) n = base + i++; used.add(n); return n; };
  for (const c of cands) {
    const vals = (c.evidence && c.evidence.values) || [];
    let base = c.kind === 'function' ? 'fn' : 'v';
    const sv = vals.map(String);
    if (sv.some((s) => /^[A-Fa-f0-9]{16,}$/.test(s))) base = c.kind === 'function' ? 'computeDigest' : 'digest';
    else if (sv.some((s) => /^[A-Za-z0-9_-]{20,}={0,2}$/.test(s))) base = c.kind === 'function' ? 'encodeToken' : 'token';
    else if (sv.every((s) => /^-?\d+$/.test(s)) && sv.length) base = c.kind === 'function' ? 'computeNum' : 'counter';
    else if (sv.some((s) => /[=&?]/.test(s))) base = 'payload';
    else if (c.kind === 'function' && c.evidence && c.evidence.calls > 50) base = 'hotFn';
    map[c.name] = uniq(base);
  }
  return map;
}

// deterministic, scope-preserving rename — the SAFE half (humanify's key principle)
function applyRenames(src, map) {
  const ast = babel.parse(src, { configFile: false, babelrc: false, parserOpts: { errorRecovery: true, allowReturnOutsideFunction: true } });
  babel.traverse(ast, {
    Scopable(path) {
      for (const oldN in map) {
        if (path.scope.hasOwnBinding(oldN) && oldN !== map[oldN]) {
          try { path.scope.rename(oldN, map[oldN]); } catch (e) {}
        }
      }
    },
  });
  return babel.transformFromAstSync(ast, null, { code: true, configFile: false, babelrc: false, compact: false }).code;
}

function buildPrompt(bundle) {
  return [
    'You are reverse-engineering obfuscated JavaScript. For each identifier below you are given its',
    'kind, reference count, and — crucially — RUNTIME TRACE EVIDENCE (actual values it held, call',
    'counts, return values). Suggest a concise, descriptive camelCase name. Reply ONLY with JSON:',
    '{"<oldName>":"<newName>", ...}. Do not restructure code; names only.',
    '',
    JSON.stringify(bundle.cands.map((c) => ({ name: c.name, kind: c.kind, refs: c.refs, evidence: c.evidence })), null, 2),
  ].join('\n');
}

// optional network call — provider-pluggable; default model mirrors humanify (claude-sonnet-4-6).
async function callModel(provider, bundle) {
  const prompt = buildPrompt(bundle);
  if (provider === 'claude') {
    const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.JT_MODEL || 'claude-sonnet-4-6', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json(); const text = (j.content && j.content[0] && j.content[0].text) || '{}';
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  }
  if (provider === 'gpt' || provider === 'gemini') {
    throw new Error(provider + ' path: set the endpoint/key (same shape as claude) — not wired with a key here');
  }
  throw new Error('unknown provider ' + provider);
}

module.exports = { extractCandidates, gatherEvidence, heuristicNames, applyRenames, buildPrompt, callModel };
