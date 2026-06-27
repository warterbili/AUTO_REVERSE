'use strict';
// aggregate.js — turn a raw trace into something a human/LLM can read.
//
//   node src/aggregate.js <trace.json> [--top 40]
//
// Produces:
//   - call summary: per-function hit count + first line
//   - dynamic-codegen layers: every eval/Function/setTimeout string captured (the
//     code that only existed at runtime — usually where the real algorithm hides)
//   - hot variables: most-assigned identifiers with a sample of their values
//   - crypto/encode hints: values that look like hashes / base64 / hex tokens
//
// This is the "don't drown in a million events" stage. Heuristic, not authoritative.

const fs = require('fs');

const looksInteresting = (s) =>
  typeof s === 'string' &&
  s.length >= 16 &&
  (/^[A-Fa-f0-9]{16,}$/.test(s) ||             // hex digest
    /^[A-Za-z0-9_-]{20,}={0,2}$/.test(s) ||     // base64/base64url token
    /^[\w-]+\.[\w-]+\.[\w-]+$/.test(s));        // jwt-ish

function aggregate(dump, top) {
  const ev = dump.events || [];
  const fns = new Map();
  const vars = new Map();
  const dyn = [];
  const interesting = [];
  const opHist = new Map();
  const opStream = [];

  for (const e of ev) {
    if (e.t === 'vm') {
      const k = String(typeof e.op === 'object' ? (e.op.ty || '?') : e.op);
      opHist.set(k, (opHist.get(k) || 0) + 1);
      if (opStream.length < 200) opStream.push(typeof e.op === 'object' ? '?' : e.op);
      continue;
    }
    if (e.t === 'enter') {
      const k = e.id;
      const cur = fns.get(k) || { id: e.id, name: e.name, line: e.line, calls: 0 };
      cur.calls++;
      fns.set(k, cur);
    } else if (e.t === 'set') {
      const cur = vars.get(e.name) || { name: e.name, sets: 0, samples: [] };
      cur.sets++;
      if (cur.samples.length < 5 && e.val) cur.samples.push(e.val.v !== undefined ? e.val.v : `<${e.val.ty}>`);
      vars.set(e.name, cur);
      if (e.val && looksInteresting(e.val.v)) interesting.push({ name: e.name, line: e.line, v: e.val.v });
    } else if (e.t === 'dyn') {
      dyn.push({ kind: e.kind, len: e.len, src: e.src });
    } else if (e.t === 'get') {
      if (e.val && looksInteresting(e.val.v)) interesting.push({ prop: e.prop, line: e.line, v: e.val.v });
    }
  }

  const byCalls = [...fns.values()].sort((a, b) => b.calls - a.calls).slice(0, top);
  const bySets = [...vars.values()].sort((a, b) => b.sets - a.sets).slice(0, top);
  const opcodes = [...opHist.entries()].sort((a, b) => b[1] - a[1]);

  return { totals: { events: dump.total, kept: ev.length, dropped: dump.dropped }, byCalls, bySets, dyn, interesting: interesting.slice(0, top), opcodes, opStream };
}

function render(a) {
  const L = [];
  L.push(`# trace summary`);
  L.push(`events=${a.totals.events} kept=${a.totals.kept} dropped=${a.totals.dropped}`);
  L.push('');
  L.push(`## dynamic code-gen layers (${a.dyn.length}) — the real algorithm usually lives here`);
  a.dyn.forEach((d, i) => L.push(`  [${i}] ${d.kind} (${d.len} chars): ${JSON.stringify(d.src).slice(0, 160)}`));
  L.push('');
  L.push(`## hottest functions`);
  a.byCalls.forEach((f) => L.push(`  ${String(f.calls).padStart(7)}×  #${f.id} ${f.name} @L${f.line}`));
  L.push('');
  L.push(`## hottest variables`);
  a.bySets.forEach((v) => L.push(`  ${String(v.sets).padStart(7)}×  ${v.name}  e.g. ${JSON.stringify(v.samples.slice(0, 3))}`));
  L.push('');
  L.push(`## interesting values (hash / base64 / token shaped) — candidate sign outputs`);
  a.interesting.forEach((x) => L.push(`  ${x.name || x.prop} @L${x.line}: ${JSON.stringify(x.v)}`));
  if (a.opcodes && a.opcodes.length) {
    L.push('');
    L.push(`## VM opcode histogram (L3 dispatch-loop trace) — ${a.opcodes.length} distinct opcodes`);
    a.opcodes.slice(0, 40).forEach(([op, c]) => L.push(`  op ${String(op).padStart(4)} : ${c}×`));
    L.push(`  bytecode stream (first ${a.opStream.length}): ${a.opStream.join(' ')}`);
  }
  return L.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0];
  const topI = args.indexOf('--top');
  const top = topI >= 0 ? parseInt(args[topI + 1], 10) : 40;
  if (!file) { console.error('usage: aggregate.js <trace.json> [--top 40]'); process.exit(2); }
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const a = aggregate(dump, top);
  console.log(render(a));
}

module.exports = { aggregate, render };
