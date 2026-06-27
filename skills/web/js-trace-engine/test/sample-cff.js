// Control-flow-flattening sample: while(1){ switch(state){...} } with a state variable — the same
// shape as a JSVMP dispatch loop, so vm-locate/L3 should catch it and trace the STATE sequence.
// Flattened computation: hash("abc") -> hex, stored on globalThis.__R2.
function _flat(input) {
  var state = 0, acc = 0, i = 0, ch = 0, out;
  while (true) {
    switch (state) {
      case 0: acc = 0; state = 1; break;
      case 1: i = 0; state = 2; break;
      case 2: if (i < input.length) { state = 3; } else { state = 7; } break;
      case 3: ch = input.charCodeAt(i); state = 4; break;
      case 4: acc = acc * 31; state = 5; break;
      case 5: acc = (acc + ch) >>> 0; state = 6; break;
      case 6: i++; state = 2; break;
      case 7: out = acc.toString(16); state = 8; break;
      case 8: return out;
    }
  }
}
globalThis.__R2 = _flat('abc');
