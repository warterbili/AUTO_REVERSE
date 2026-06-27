// Synthetic JSVMP: a stack-bytecode interpreter with a backward-jump loop — the dispatch-loop
// shape L3 targets. Program computes sum(1..5) = 15 with a loop, storing it on globalThis.__R.
//
// opcodes: 0 RET | 1 PUSH imm | 2 ADD | 3 MUL | 4 SUB | 5 DUP | 6 SWAP
//          7 LOAD slot | 8 STORE slot | 9 JMP addr | 10 JZ addr | 11 LT | 12 NOP

function _vm_interp(code) {
  var stack = [];
  var locals = [];
  var pc = 0;
  while (true) {
    var op = code[pc++];
    switch (op) {
      case 0: return stack.pop();
      case 1: stack.push(code[pc++]); break;
      case 2: { var b = stack.pop(), a = stack.pop(); stack.push(a + b); break; }
      case 3: { var b3 = stack.pop(), a3 = stack.pop(); stack.push(a3 * b3); break; }
      case 4: { var b4 = stack.pop(), a4 = stack.pop(); stack.push(a4 - b4); break; }
      case 5: stack.push(stack[stack.length - 1]); break;
      case 6: { var n = stack.length; var tmp = stack[n - 1]; stack[n - 1] = stack[n - 2]; stack[n - 2] = tmp; break; }
      case 7: stack.push(locals[code[pc++]]); break;
      case 8: locals[code[pc++]] = stack.pop(); break;
      case 9: pc = code[pc]; break;
      case 10: { var addr = code[pc++]; if (stack.pop() === 0) pc = addr; break; }
      case 11: { var b11 = stack.pop(), a11 = stack.pop(); stack.push(a11 < b11 ? 1 : 0); break; }
      case 12: break;
      default: throw new Error('bad opcode ' + op);
    }
  }
}

// acc=0; i=5; while(i){ acc+=i; i-=1 } return acc   -> 15
var program = [
  1, 0, 8, 0,        // PUSH 0; STORE acc(0)
  1, 5, 8, 1,        // PUSH 5; STORE i(1)
  7, 1, 10, 28,      // LOOP(8): LOAD i; JZ END(28)
  7, 0, 7, 1, 2, 8, 0, // LOAD acc; LOAD i; ADD; STORE acc
  7, 1, 1, 1, 4, 8, 1, // LOAD i; PUSH 1; SUB; STORE i
  9, 8,              // JMP LOOP(8)
  7, 0, 0,           // END(28): LOAD acc; RET
];
globalThis.__R = _vm_interp(program);
