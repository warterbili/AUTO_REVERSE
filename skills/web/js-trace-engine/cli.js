#!/usr/bin/env node
'use strict';
// cli.js — one-shot pipeline glue for the js-trace-engine.
//
//   node cli.js trace <input.js> [--out <dir>] [--webcrack] [--members]
//                                [--freeze-clock] [--env <file.js>] [--top N]
//
// Steps:  (optional webcrack static clean) -> instrument -> run in Node harness
//         -> aggregate -> print human/LLM-readable summary.
//
// Outputs land in <dir> (default: ./jt-out):
//   instrumented.js   the woven source
//   trace.json        raw event dump
//   summary.txt       aggregated, readable view

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { instrumentCode } = require('./src/instrument');
const { aggregate, render } = require('./src/aggregate');
const { locate } = require('./src/vm-locate');
const { instrument: vmInstrument } = require('./src/vm-instrument');
const lift = require('./src/lift');
const antidebug = require('./src/anti-debug');

function arg(args, name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

async function maybeWebcrack(src, outDir) {
  try {
    const mod = require('webcrack');
    const res = await mod.webcrack(src);
    fs.writeFileSync(path.join(outDir, 'webcrack.js'), res.code);
    console.error('[cli] webcrack: static pre-clean applied');
    return res.code;
  } catch (e) {
    console.error('[cli] webcrack not available (' + e.message.split('\n')[0] + ') — skipping static pre-clean');
    return src;
  }
}

// shared tail: run the instrumented file in the Node harness, aggregate, print.
function runAndReport(instrPath, outDir, args) {
  const tracePath = path.join(outDir, 'trace.json');
  const runArgs = [path.join(__dirname, 'src', 'run-node.js'), instrPath, tracePath];
  if (args.includes('--freeze-clock')) runArgs.push('--freeze-clock');
  if (args.includes('--members')) runArgs.push('--members');
  const env = arg(args, '--env', null);
  if (env) runArgs.push('--env', env);

  const r = cp.spawnSync(process.execPath, runArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0 && !fs.existsSync(tracePath)) { console.error('[cli] harness failed, no trace produced'); process.exit(1); }

  const dump = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  const top = parseInt(arg(args, '--top', '40'), 10);
  const summary = render(aggregate(dump, top));
  const sumPath = path.join(outDir, 'summary.txt');
  fs.writeFileSync(sumPath, summary);
  console.error(`[cli] summary -> ${sumPath}\n`);
  console.log(summary);
}

async function cmdTrace(args) {
  const input = args[0];
  if (!input) { console.error('usage: cli.js trace <input.js> [--out dir] [--webcrack] [--members] [--freeze-clock] [--env f.js] [--top N]'); process.exit(2); }
  const outDir = arg(args, '--out', 'jt-out');
  fs.mkdirSync(outDir, { recursive: true });

  let src = fs.readFileSync(input, 'utf8');
  if (args.includes('--webcrack')) src = await maybeWebcrack(src, outDir);

  const members = args.includes('--members');
  const instr = instrumentCode(src, { members }).code;
  const instrPath = path.join(outDir, 'instrumented.js');
  fs.writeFileSync(instrPath, instr);
  console.error(`[cli] instrumented -> ${instrPath} (${instr.length} chars)`);
  runAndReport(instrPath, outDir, args);
}

// L3: locate the VM interpreter and instrument only its dispatch loop.
function locateAndInstrumentVM(src, outDir) {
  const cands = locate(src);
  if (!cands.length) return null;
  console.error(`[cli] ${cands.length} VM dispatcher(s) located:`);
  cands.slice(0, 8).forEach((c) => console.error(`  fn=${c.fnName}@L${c.line} kind=${c.kind} score=${c.score} op=${c.opCodeSrc} state=${c.stateVar} pc=${c.pcVar || '?'}`));
  const res = vmInstrument(src, cands);
  if (!res.instrumented) { console.error('[cli] VM located but dispatch point not instrumentable — falling back'); return null; }
  console.error(`[cli] instrumented ${res.count} dispatcher(s)`);
  const instrPath = path.join(outDir, 'vm-instrumented.js');
  fs.writeFileSync(instrPath, res.code);
  console.error(`[cli] dispatch-loop instrumented -> ${instrPath}`);
  return instrPath;
}

async function cmdVmtrace(args) {
  const input = args[0];
  if (!input) { console.error('usage: cli.js vmtrace <input.js> [--out dir] [--freeze-clock] [--env f.js] [--top N]'); process.exit(2); }
  const outDir = arg(args, '--out', 'jt-out');
  fs.mkdirSync(outDir, { recursive: true });
  let src = fs.readFileSync(input, 'utf8');
  if (args.includes('--webcrack')) src = await maybeWebcrack(src, outDir);
  const instrPath = locateAndInstrumentVM(src, outDir);
  if (!instrPath) { console.error('[cli] no VM interpreter found; use `trace` instead'); process.exit(1); }
  runAndReport(instrPath, outDir, args);
}

// auto-router: fingerprint the target and pick the layer.
async function cmdAuto(args) {
  const input = args[0];
  if (!input) { console.error('usage: cli.js auto <input.js> [--out dir] [--freeze-clock] [--members] [--env f.js] [--top N]'); process.exit(2); }
  const outDir = arg(args, '--out', 'jt-out');
  fs.mkdirSync(outDir, { recursive: true });
  let src = fs.readFileSync(input, 'utf8');
  if (args.includes('--webcrack')) src = await maybeWebcrack(src, outDir);

  const cands = locate(src);
  if (cands.length) {
    console.error(`[cli] auto: JSVMP fingerprint hit (score=${cands[0].score}) -> L3 dispatch-loop trace`);
    const instrPath = locateAndInstrumentVM(src, outDir);
    if (instrPath) return runAndReport(instrPath, outDir, args);
  }
  console.error('[cli] auto: no strong VM -> L1+L2 source/runtime trace');
  const instr = instrumentCode(src, { members: args.includes('--members') }).code;
  const instrPath = path.join(outDir, 'instrumented.js');
  fs.writeFileSync(instrPath, instr);
  runAndReport(instrPath, outDir, args);
}

// LLM-lift: rename obfuscated identifiers using static + runtime-trace evidence.
async function cmdLift(args) {
  const input = args[0];
  if (!input) { console.error('usage: cli.js lift <source.js> --trace trace.json [--model none|claude] [--apply] [--out dir]'); process.exit(2); }
  const outDir = arg(args, '--out', 'jt-out');
  fs.mkdirSync(outDir, { recursive: true });
  const src = fs.readFileSync(input, 'utf8');
  const tracePath = arg(args, '--trace', path.join(outDir, 'trace.json'));
  const trace = fs.existsSync(tracePath) ? JSON.parse(fs.readFileSync(tracePath, 'utf8')) : { events: [] };

  const cands = lift.extractCandidates(src);
  const bundle = lift.gatherEvidence(cands, trace);
  fs.writeFileSync(path.join(outDir, 'analysis-bundle.json'), JSON.stringify(bundle, null, 2));
  fs.writeFileSync(path.join(outDir, 'prompt.txt'), lift.buildPrompt(bundle));
  console.error(`[lift] ${cands.length} obfuscated identifiers; dyn-codegen=${bundle.dynamicCodegen} opcodes=${bundle.opcodes}`);

  const model = arg(args, '--model', 'none');
  let map;
  if (model === 'none') { map = lift.heuristicNames(cands); console.error('[lift] model=none -> heuristic baseline names'); }
  else { map = await lift.callModel(model, bundle); console.error(`[lift] model=${model} -> ${Object.keys(map).length} suggestions`); }
  fs.writeFileSync(path.join(outDir, 'renames.json'), JSON.stringify(map, null, 2));

  if (args.includes('--apply')) {
    const renamed = lift.applyRenames(src, map);
    const rp = path.join(outDir, 'lifted.js');
    fs.writeFileSync(rp, renamed);
    console.error(`[lift] applied renames -> ${rp}`);
  }
  console.log(JSON.stringify(map, null, 2));
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'trace') return cmdTrace(rest);
  if (cmd === 'vmtrace') return cmdVmtrace(rest);
  if (cmd === 'auto') return cmdAuto(rest);
  if (cmd === 'lift') return cmdLift(rest);
  if (cmd === 'replace') return require('./src/cdp-replace').run(rest); // Mode-C live source replacement
  if (cmd === 'verify') return require('./src/cdp-verify').run(rest);   // anti-debug bypass verification
  if (cmd === 'reqdiff') return require('./src/cdp-reqdiff').run(rest); // byte-diff browser request vs your replay
  console.error('commands:');
  console.error('  auto | trace | vmtrace <f.js> [opts]            offline instrument/trace');
  console.error('  lift <src.js> --trace t.json [--model none|claude] [--apply]');
  console.error('  replace --url <u> [--rules boss|web-antidebug|file] [--anti-debug] [--instrument] [--no-inject] [--strip-sri] [--match "*.js*"] [--port 9222]');
  console.error('  verify  --port <p> [--match zhipin] [--seconds 6] [--selector "a[href*=job_detail]"]');
  console.error('  reqdiff --url <api-substr> [--match host] [--mine mine.json] [--port <p>]   # "browser works, replay doesn\'t" → diff the two');
  console.error('opts: [--out dir] [--freeze-clock] [--members] [--env f.js] [--webcrack] [--anti-debug] [--top N]');
  process.exit(2);
}

main().catch((e) => { console.error('[cli] ' + e.message); process.exit(1); });
