'use strict';
// Capture ONE complete u.g() call, full (untruncated) — for byte-exact generator verification.
Java.perform(function () {
  var done = false;
  var rec = {};
  var F = Java.use('io.castle.highwind.android.f');
  var R = Java.use('io.castle.highwind.android.d');     // d.c() motion; d extends u
  var U = Java.use('io.castle.highwind.android.u');

  F.a.overload().implementation = function () {
    var a0 = this.a();
    if (!done) { rec.fp_main = a0.a.value; rec.fp_main_size = a0.b.value; }
    return a0;
  };
  // bPart is u.b() -> r ; hook r.a()
  var Rr = Java.use('io.castle.highwind.android.r');
  Rr.a.overload().implementation = function () {
    var a0 = this.a();
    if (!done) { rec.b_part = a0.a.value; rec.b_part_size = a0.b.value; }
    return a0;
  };
  R.c.implementation = function () {
    var s = this.c();
    if (!done) rec.motion = s;
    return s;
  };
  U.g.implementation = function () {
    var t = this.g();
    if (!done) {
      try { rec.pk = this.a.value; } catch(e){}
      try { rec.uuid = this.d.value; } catch(e){}
      try { rec.version = this.e.value; } catch(e){}
      rec.token = t;
      done = true;
      console.log('@@@REC_START@@@');
      console.log(JSON.stringify(rec));
      console.log('@@@REC_END@@@');
    }
    return t;
  };
  console.log('[*] capture-one ready');
});
