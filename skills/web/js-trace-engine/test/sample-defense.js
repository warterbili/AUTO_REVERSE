// Exercises the L2 anti-detection layer: native-code checks on our hooked eval/Function,
// and return-value capture. globalThis.__CHK collects pass/fail for the harness to print.

var ok1 = eval.toString().indexOf('[native code]') !== -1;                       // hooked eval looks native
var ok2 = Function.prototype.toString.call(eval).indexOf('[native code]') !== -1; // the HARD one (FPT.call)
var ok3 = Function.prototype.toString.call(Function.prototype.toString)           // the hook hides itself
  .indexOf('[native code]') !== -1;

function compute(x) {
  var y = x * 2;
  return y + 1; // <- return value captured by __T.ret
}
var r = compute(20); // 41

// dynamic codegen still works through the hook (and gets re-instrumented)
var f = new Function('a', 'return a * a;');
var sq = f(7); // 49

globalThis.__CHK = { ok1: ok1, ok2: ok2, ok3: ok3, r: r, sq: sq };
