'use strict';
// L4 — native-memory instrumentation (Frida). The SAME kernel as L1 (enter/exit probes), but
// the probe is injected into machine code in memory via Interceptor.attach instead of into
// source via Babel. Invisible to all JS-level integrity/anti-debug checks because it lives
// below JavaScript.
//
// Two uses in this framework:
//   1. The JS engine's bytecode dispatch (e.g. a QuickJS `JS_CallInternal` in a stripped binary)
//      — hook the dispatch and read (pc, opcode) from registers/args to get an opcode trace
//      without rebuilding the engine (the binary-only equivalent of L3b).
//   2. The native sign function in an Android `.so` (this repo's bread and butter) — capture the
//      JNI sign's inputs/outputs at the memory layer when the algorithm isn't in JS at all.
//
// Config via Frida script parameters (`-P '{...}'`) or the defaults below.
//   { module: "libsign.so", symbol: "sign", offset: null, argc: 4, dumpArgs: true, retLen: 64 }
// Use `offset` (hex, relative to module base) when the symbol is stripped.
//
// Emits the same event shape as the JS layers via send(), so run-frida.py merges it into trace.json.

const CFG = Object.assign(
  { module: null, symbol: null, offset: null, argc: 4, dumpArgs: true, dumpRet: true, retLen: 64, waitForLoad: true },
  (typeof parameters !== 'undefined' && parameters) || {}
);

function readArg(p) {
  try {
    if (p === null || p.isNull()) return { ty: 'ptr', v: 'null' };
    // try to read it as a C string first (common for sign inputs)
    const s = p.readUtf8String(80);
    if (s && /[\x20-\x7e]/.test(s)) return { ty: 'string', v: s.length > 64 ? s.slice(0, 64) + '…' : s };
  } catch (e) {}
  try { return { ty: 'ptr', v: p.toString() }; } catch (e) { return { ty: 'ptr', v: '?' }; }
}

function attach(addr, label) {
  let depth = 0;
  Interceptor.attach(addr, {
    onEnter(args) {
      depth++;
      const a = [];
      if (CFG.dumpArgs) for (let i = 0; i < CFG.argc; i++) a.push(readArg(args[i]));
      this._a = a;
      send({ t: 'enter', name: label, d: depth, args: a });
    },
    onLeave(retval) {
      let r;
      if (CFG.dumpRet) {
        r = readArg(retval);
        try { const hx = Memory.readByteArray(retval, Math.min(CFG.retLen, 64)); if (hx) r.hex = Array.from(new Uint8Array(hx)).map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) {}
      }
      send({ t: 'ret', name: label, d: depth, val: r });
      depth--;
    },
  });
  send({ t: 'note', tag: 'attached', msg: label + ' @ ' + addr });
}

function resolveAndAttach() {
  const mod = Process.findModuleByName(CFG.module);
  if (!mod) return false;
  let addr = null;
  if (CFG.offset != null) addr = mod.base.add(ptr(CFG.offset));
  else if (CFG.symbol) { const s = Module.findExportByName(CFG.module, CFG.symbol) || DebugSymbol.fromName(CFG.symbol).address; addr = s; }
  if (!addr || addr.isNull()) return false;
  attach(addr, CFG.module + '!' + (CFG.symbol || CFG.offset));
  return true;
}

if (!resolveAndAttach() && CFG.waitForLoad) {
  // module not loaded yet (packed/late dlopen) — wait for it
  const dlopen = Module.findExportByName(null, 'android_dlopen_ext') || Module.findExportByName(null, 'dlopen');
  if (dlopen) {
    Interceptor.attach(dlopen, {
      onEnter(a) { try { this.path = a[0].readCString(); } catch (e) {} },
      onLeave() { if (this.path && CFG.module && this.path.indexOf(CFG.module) !== -1) { if (resolveAndAttach()) send({ t: 'note', tag: 'late-attach', msg: this.path }); } },
    });
  }
  send({ t: 'note', tag: 'waiting', msg: 'module ' + CFG.module + ' not loaded; watching dlopen' });
}
