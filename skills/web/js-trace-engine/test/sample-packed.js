// Regression test for the Boss-zhipin-style dispatcher (learned from the real zpAegis token VM):
//   - loop condition is `p !== void 0` (NOT while(true))
//   - the state `p` is a PACKED integer, bit-sliced into the switch discriminant `31 & p`
//   - leaves reassign `p` to the next packed state
// The locator must (a) detect this as a VM dispatcher and (b) resolve the state var to `p`.
// Computes sum(1..5) = 15 -> globalThis.__RP.
function _packed() {
  var p = 0,
    acc = 0,
    i = 0;
  for (; p !== void 0; ) {
    var op = 31 & p; // derived discriminant (Boss: 31 & p, 31 & p>>5, 31 & p>>10)
    switch (op) {
      case 0: acc = 0; p = 1; break;
      case 1: i = 1; p = 2; break;
      case 2: p = i <= 5 ? 3 : 7; break;
      case 3: acc = acc + i; p = 4; break;
      case 4: i = i + 1; p = 2; break;
      case 7: p = void 0; break; // halt
    }
  }
  return acc;
}
globalThis.__RP = _packed();
