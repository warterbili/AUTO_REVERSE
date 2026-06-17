'use strict';
// Castle.io v3.1.1 (Highwind) token capture for DailyPay
// Hooks: Castle.createRequestToken, u.g() (builder + fields), f.a() (main fp), d.c() (motion)
function bytesToHexPreview(s, max) {
  try { return s.length > max ? s.substring(0, max) + '…(' + s.length + ')' : s; }
  catch (e) { return String(s); }
}

Java.perform(function () {
  console.log('[*] Castle hook loaded');

  // --- public entry ---
  try {
    var Castle = Java.use('io.castle.android.Castle');
    Castle.createRequestToken.implementation = function () {
      var t = this.createRequestToken();
      console.log('\n[TOKEN] X-Castle-Request-Token = ' + t);
      return t;
    };
    console.log('[+] hooked Castle.createRequestToken');
  } catch (e) { console.log('[-] Castle hook: ' + e); }

  // --- token builder u.g() + dump obfuscated fields a/b/c/d/e ---
  try {
    var U = Java.use('io.castle.highwind.android.u');
    U.g.implementation = function () {
      var out = this.g();
      try {
        console.log('[u.g] pk(a)      = ' + this.a.value);
        console.log('[u.g] this.b     = ' + this.b.value);
        console.log('[u.g] this.c(tail)= ' + bytesToHexPreview(this.c.value, 40));
        console.log('[u.g] uuid(d)    = ' + this.d.value);
        console.log('[u.g] version(e) = ' + this.e.value);
      } catch (e2) { console.log('[u.g] field dump err: ' + e2); }
      console.log('[u.g] => token   = ' + out);
      return out;
    };
    console.log('[+] hooked u.g()');
  } catch (e) { console.log('[-] u.g hook: ' + e); }

  // --- main fingerprint f.a() -> a0(data,size) ---
  try {
    var F = Java.use('io.castle.highwind.android.f');
    F.a.overload().implementation = function () {
      var a0 = this.a();
      try {
        console.log('[f.a] fp.size = ' + a0.b.value);
        console.log('[f.a] fp.data = ' + bytesToHexPreview(a0.a.value, 400));
      } catch (e2) { console.log('[f.a] dump err: ' + e2); }
      return a0;
    };
    console.log('[+] hooked f.a()');
  } catch (e) { console.log('[-] f.a hook: ' + e); }

  // --- motion section d.c() ---
  try {
    var D = Java.use('io.castle.highwind.android.d');
    D.c.implementation = function () {
      var s = this.c();
      console.log('[d.c] motion = ' + bytesToHexPreview(s, 200));
      return s;
    };
    console.log('[+] hooked d.c()');
  } catch (e) { console.log('[-] d.c hook: ' + e); }

  console.log('[*] all hooks installed; waiting for token generation...');
});
