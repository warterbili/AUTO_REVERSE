'use strict';
// Build a {number: name} opcode table from QuickJS's quickjs-opcode.h.
// QuickJS assigns opcode numbers by the order of DEF(...) / def(...) macros in that header.
//
//   node make-opcode-table.js path/to/quickjs-opcode.h > opcode-table.json
//
// Pass the result to qjs-trace-to-json.js to get readable opcode names (OP_add, OP_call, …).

const fs = require('fs');
const hdr = process.argv[2];
if (!hdr) { console.error('usage: make-opcode-table.js path/to/quickjs-opcode.h > opcode-table.json'); process.exit(2); }

const text = fs.readFileSync(hdr, 'utf8');
const table = {};
let i = 0;
// matches DEF(name, ...) and FMT(...)-style def lines; ignore #if/#endif and comments
for (const line of text.split('\n')) {
  const m = line.match(/^\s*(?:DEF|def)\(\s*([A-Za-z0-9_]+)\s*,/);
  if (!m) continue;
  table[i] = 'OP_' + m[1];
  i++;
}
process.stdout.write(JSON.stringify(table, null, 0));
console.error(`[make-opcode-table] ${i} opcodes`);
