'use strict';
// prelude.js — L2 runtime layer: the trace sink + the anti-detection / recursion hooks.
//
// installPrelude(globalObj, opts) must run BEFORE the target code, and the harness
// must set globalObj.__instrument = (src, opts) => instrumentedSource (wired in run-node.js).
//
// What it installs on the global object:
//   __T                         the trace sink (enter/exit/set/get/dyn/note + buffer)
//   eval        (hooked)        captures the string, re-instruments it, then real-evals
//   Function    (hooked)        same for `new Function(body)` / Function('debu'+'gger')()
//   setTimeout/setInterval      string-form callbacks captured + re-instrumented
//   Date.now / performance.now  optional monotonic clock freeze (defeats timing anti-debug)
//
// Honest limits (documented, not hidden):
//   * Hooking global eval turns calls into INDIRECT eval (global scope). Fine for the
//     usual obfuscator pattern `eval(decrypt(...))`; breaks eval that relies on local scope.
//   * toString spoofing covers `eval.toString()` but NOT `Function.prototype.toString.call(eval)`
//     or cross-realm (fresh-iframe) native checks. Those need a Proxy/L3 — see references/.

function installPrelude(g, opts = {}) {
  opts = Object.assign({ freezeClock: false, cap: 1_000_000, sampleEvery: 1 }, opts);

  // ---- trace sink -------------------------------------------------------
  const buf = [];
  let n = 0;
  let dropped = 0;
  const depthByMethod = { enter: 0 };
  const push = (ev) => {
    n++;
    if (opts.sampleEvery > 1 && ev.t !== 'enter' && ev.t !== 'dyn' && n % opts.sampleEvery !== 0) return;
    if (buf.length >= opts.cap) { dropped++; return; }
    buf.push(ev);
  };
  const safe = (v) => {
    // compact, side-effect-free preview of a value
    try {
      const ty = typeof v;
      if (v === null) return { ty: 'null' };
      if (ty === 'function') return { ty: 'function', name: v.name || '' };
      if (ty === 'object') {
        if (Array.isArray(v)) return { ty: 'array', len: v.length };
        const ctor = v.constructor && v.constructor.name;
        return { ty: 'object', ctor: ctor || 'Object' };
      }
      if (ty === 'string') return { ty, len: v.length, v: v.length > 120 ? v.slice(0, 120) + '…' : v };
      return { ty, v };
    } catch (e) {
      return { ty: 'unreadable' };
    }
  };

  const __T = {
    enter(id, name, line) { depthByMethod.enter++; push({ t: 'enter', id, name, line, d: depthByMethod.enter }); },
    exit(id) { push({ t: 'exit', id, d: depthByMethod.enter }); depthByMethod.enter = Math.max(0, depthByMethod.enter - 1); },
    set(name, val, line) { push({ t: 'set', name, line, val: safe(val) }); return val; },
    ret(id, val) { push({ t: 'ret', id, val: safe(val) }); return val; },
    get(prop, val, line) { push({ t: 'get', prop, line, val: safe(val) }); return val; },
    dyn(kind, src) { push({ t: 'dyn', kind, len: src.length, src: src.length > 400 ? src.slice(0, 400) + '…' : src }); },
    vm(pc, op) { push({ t: 'vm', pc: typeof pc === 'number' ? pc : undefined, op: typeof op === 'number' || typeof op === 'string' ? op : safe(op) }); return op; },
    note(tag, msg) { push({ t: 'note', tag, msg: String(msg).slice(0, 300) }); },
    _dump() { return { events: buf, total: n, dropped }; },
  };
  g.__T = __T;

  // ---- recursive eval / Function hooks ---------------------------------
  const reinstrument = (src, kind) => {
    if (typeof g.__instrument !== 'function') return src;
    try {
      return g.__instrument(src, { dynamic: true, members: !!opts.members });
    } catch (e) {
      __T.note('instrument-fail:' + kind, e && e.message);
      return src;
    }
  };

  // toString redirection: every function we install must look native, OR (for our own
  // instrumented functions) return its original source — defeats both the eval/Function
  // native-check and the regex self-defending integrity check. We register a spoof string
  // per hooked function and override Function.prototype.toString to consult the registry.
  const nativeSpoof = new WeakMap(); // fn -> string its .toString() should return
  const RealFunction = g.Function;
  const realFPToString = RealFunction.prototype.toString;
  const spoofToString = function () {
    if (nativeSpoof.has(this)) return nativeSpoof.get(this);
    return realFPToString.call(this);
  };
  nativeSpoof.set(spoofToString, 'function toString() { [native code] }'); // hide the hook itself
  try {
    Object.defineProperty(RealFunction.prototype, 'toString', {
      value: spoofToString, writable: true, configurable: true,
    });
  } catch (e) { __T.note('toString-hook-fail', e && e.message); }
  const markNative = (fn, name) => { try { nativeSpoof.set(fn, `function ${name}() { [native code] }`); } catch (e) {} return fn; };
  // expose for the harness to register instrumented functions' original source
  g.__spoofSource = (fn, src) => { try { nativeSpoof.set(fn, src); } catch (e) {} return fn; };

  const realEval = g.eval;
  const hookedEval = function (src) {
    if (typeof src === 'string') {
      __T.dyn('eval', src);
      src = reinstrument(src, 'eval');
    }
    return realEval(src); // indirect eval -> global scope (documented limitation)
  };
  markNative(hookedEval, 'eval');
  g.eval = hookedEval;

  const HookedFunction = function (...args) {
    if (args.length) {
      const body = String(args[args.length - 1]);
      __T.dyn('Function', body);
      args[args.length - 1] = reinstrument(body, 'Function');
    }
    return RealFunction.apply(this, args);
  };
  HookedFunction.prototype = RealFunction.prototype;
  HookedFunction.prototype.constructor = HookedFunction;
  markNative(HookedFunction, 'Function');
  g.Function = HookedFunction;

  // string-form setTimeout/setInterval are a code-gen vector too
  for (const tname of ['setTimeout', 'setInterval']) {
    const real = g[tname];
    if (typeof real !== 'function') continue;
    const hooked = function (handler, ...rest) {
      if (typeof handler === 'string') {
        __T.dyn(tname, handler);
        const instr = reinstrument(handler, tname);
        return real(function () { return hookedEval(instr); }, ...rest);
      }
      return real(handler, ...rest);
    };
    markNative(hooked, tname);
    g[tname] = hooked;
  }

  // document.write / writeln deliver <script> too — at least capture them
  try {
    if (g.document && typeof g.document.write === 'function') {
      const realWrite = g.document.write.bind(g.document);
      g.document.write = function (s) { if (typeof s === 'string' && /<script/i.test(s)) __T.dyn('document.write', s); return realWrite(s); };
    }
  } catch (e) {}

  // ---- optional clock freeze (defeats timing-based anti-debug) ----------
  if (opts.freezeClock) {
    let clk = 1_600_000_000_000;
    try { g.Date.now = () => (clk += 1); } catch (e) {}
    try { if (g.performance) g.performance.now = () => ((clk += 0.01) % 1e9); } catch (e) {}
  }

  return __T;
}

module.exports = { installPrelude };
