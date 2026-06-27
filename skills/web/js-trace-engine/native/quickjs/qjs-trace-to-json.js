'use strict';
// Convert the patched-QuickJS opcode log ("<bytecode-ptr> <offset> <opcode>" per line) into the
// js-trace-engine trace.json shape, so src/aggregate.js renders the same VM opcode histogram.
//
//   node qjs-trace-to-json.js trace.txt [opcode-table.json] > trace.json
//
// opcode-table.json (optional): { "<num>": "<name>", ... } from make-opcode-table.js — maps raw
// QuickJS opcode numbers to names (OP_push_i32, OP_call, OP_add, …).

const fs = require('fs');

const inFile = process.argv[2];
const tableFile = process.argv[3];
if (!inFile) { console.error('usage: qjs-trace-to-json.js trace.txt [opcode-table.json]'); process.exit(2); }

const names = tableFile ? JSON.parse(fs.readFileSync(tableFile, 'utf8')) : null;
const lines = fs.readFileSync(inFile, 'utf8').split('\n');

const events = [];
let n = 0;
for (const ln of lines) {
  const m = ln.match(/^(\S+)\s+(-?\d+)\s+(\d+)$/);
  if (!m) continue;
  n++;
  const off = parseInt(m[2], 10);
  const opNum = parseInt(m[3], 10);
  events.push({ t: 'vm', pc: off, op: names && names[opNum] ? names[opNum] : opNum });
}
process.stdout.write(JSON.stringify({ events, total: n, dropped: 0 }));
console.error(`[qjs-trace-to-json] ${n} opcodes -> trace.json`);
