// Two INDEPENDENT dispatch loops in one function — proves multi-dispatcher detection.
// Each is its own state machine with its own state var; the locator must report BOTH.
function _twoMachines(input) {
  // machine A: sum 1..n  (state sA)
  var sA = 0, accA = 0, iA = 0;
  for (; sA !== void 0; ) {
    switch (sA) {
      case 0: accA = 0; iA = 1; sA = 1; break;
      case 1: sA = iA <= input ? 2 : 3; break;
      case 2: accA += iA; iA++; sA = 1; break;
      case 3: sA = void 0; break;
    }
  }
  // machine B: factorial-ish via a separate flattened loop (state sB)
  var sB = 0, accB = 1, iB = 0;
  while (sB !== -1) {
    switch (sB) {
      case 0: accB = 1; iB = 1; sB = 1; break;
      case 1: sB = iB <= input ? 2 : 3; break;
      case 2: accB *= iB; iB++; sB = 1; break;
      case 3: sB = -1; break;
    }
  }
  return accA + accB;
}
globalThis.__RM = _twoMachines(4); // (1+2+3+4)=10 + 4!=24 => 34
