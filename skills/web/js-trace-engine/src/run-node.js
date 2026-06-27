'use strict';
// run-node.js — Mode B harness: run instrumented JS bare in Node and collect the trace.
//
//   node src/run-node.js <instrumented.js> <trace-out.json> [--freeze-clock] [--members] [--env <file.js>]
//
// --env points at an environment-supplement module (e.g. produced by the
// env-supplement-proxy skill) that defines window/navigator/document on the global
// object. This engine OBSERVES; env-supplement-proxy makes the code RUNNABLE. They stack.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { instrumentCode } = require('./instrument');
const { installPrelude } = require('./prelude');

function main(argv) {
  const args = argv.slice(2);
  const inPath = args[0];
  const outPath = args[1];
  if (!inPath || !outPath) {
    console.error('usage: run-node.js <instrumented.js> <trace-out.json> [--freeze-clock] [--members] [--env <file.js>]');
    process.exit(2);
  }
  const opts = {
    freezeClock: args.includes('--freeze-clock'),
    members: args.includes('--members'),
  };
  const envIdx = args.indexOf('--env');
  const envFile = envIdx >= 0 ? args[envIdx + 1] : null;

  const g = global;
  // recursion wiring: prelude's eval/Function hooks call back into the instrumenter
  g.__instrument = (src, o) => instrumentCode(src, o).code;

  // load env supplement first (so the target's window/navigator exist)
  if (envFile) {
    try { require(path.resolve(envFile)); }
    catch (e) { console.error('[run-node] env load failed:', e.message); }
  }

  const __T = installPrelude(g, opts);

  const code = fs.readFileSync(inPath, 'utf8');
  let failed = null;
  try {
    vm.runInThisContext(code, { filename: path.basename(inPath) });
  } catch (e) {
    failed = (e && e.stack) || String(e);
    __T.note('run-error', failed);
  }

  const dump = __T._dump();
  fs.writeFileSync(outPath, JSON.stringify(dump));
  const dyn = dump.events.filter((e) => e.t === 'dyn').length;
  console.error(
    `[run-node] events=${dump.total} kept=${dump.events.length} dropped=${dump.dropped} dyn-codegen=${dyn}` +
    (failed ? ' (target threw — see run-error note)' : '')
  );
}

main(process.argv);
