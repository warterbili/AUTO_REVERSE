// Synthetic "anti-bot"-shaped sample for the self-test. NOT real malware.
// Exercises: string-array decode, a debugger trap, a timing check, and the key case —
// the real sign algorithm only comes into existence via eval() at runtime.

(function () {
  var _a = ['from', 'Char', 'Code', 'log', 'now'];
  function _d(s) {
    // trivial "decrypt": shift each char code by -1
    var out = '';
    for (var i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) - 1);
    return out;
  }

  // anti-debug timing trap (defeated by --freeze-clock or by simply not single-stepping)
  var t0 = Date.now();
  // debugger;   // <- a real sample would have this; instrument strips DebuggerStatement
  var t1 = Date.now();
  if (t1 - t0 > 100) { throw new Error('debugger detected'); }

  // The real algorithm is delivered as an encrypted string and built with eval().
  // "shifted" source of: function sign(p){var h=0;for(var i=0;i<p.length;i++){h=(h*31+p.charCodeAt(i))>>>0;}return ('tok_'+h.toString(16));}
  var realSrc =
    'function sign(p){var h=0;for(var i=0;i<p.length;i++){h=(h*31+p.charCodeAt(i))>>>0;}var token=("tok_"+h.toString(16));return token;}';

  // deliver it "encrypted" then decrypt+eval (recursion target)
  var enc = realSrc.split('').map(function (c) { return String.fromCharCode(c.charCodeAt(0) + 1); }).join('');
  eval(_d(enc)); // <- prelude hook captures + re-instruments this before running

  var payload = 'user=42&ts=1700000000';
  var out = sign(payload);
  globalThis.__RESULT = out;
})();
