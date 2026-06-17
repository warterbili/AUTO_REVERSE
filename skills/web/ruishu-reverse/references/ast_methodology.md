# AST Analysis Methodology: JSVMP Reverse Engineering

## Why AST Is the Optimal Approach for JSVMP Reversing

### The Nature of JSVMP

Ruishu's JS Virtual Machine Protection (JSVMP) architecture:

```
Layer 1: mainjs → decode cd → generate eval code    (outer VM, already rewritten by Coder)
Layer 2: eval code → while(1) with 741 state codes   (outer state machine)
Layer 3: inner VM → 407 functions, 114 opcodes       (bytecode interpreter)
```

Key insight: **the eval code is valid JS**, and can be fully parsed by a standard AST parser (acorn/babel). Although the code is heavily obfuscated (shuffled variable names, binary-search if-else, multi-level nesting), its syntactic structure is intact, so AST can precisely extract every semantic unit.

### What AST Can Do

1. Extract the JS implementations of all 114 opcodes from the 34KB VM interpreter `_$_I`
2. Find the 440+ functions registered into `rt[]` and build a complete mapping table
3. Locate the exact positions of specific algorithms (SHA-1, Huffman, AES)
4. Trace data flow: the complete call chain from the entry function to the final output
5. Automatically disassemble bytecode → readable assembly → pseudo JS code

### What AST Cannot Do

1. Cannot replace data-driven analysis: AST tells you "how it computes", but the concrete values of basearr still have to be obtained by comparing against real data
2. Cannot be reused across versions: variable names are shuffled differently each time, so AST scripts must be adapted to the variable names
3. Cannot handle runtime state: dynamically generated string tables and branches decided at runtime cannot be obtained directly via AST

---

## Four-Step Decompilation Pipeline

### Step 1: AST Extraction of Opcodes → opcodes.json

**Input**: eval_code.js (296KB, obfuscated JS)
**Output**: opcodes.json (JS implementations of 114 opcodes)

Core method: find the VM interpreter function `_$_I` (34KB), traverse all conditional branches of the form `if(varName === N)` in its AST; each branch corresponds to one opcode.

```javascript
const acorn = require('acorn');
const walk = require('acorn-walk');

const code = fs.readFileSync('eval_code.js', 'utf-8');
const ast = acorn.parse(code, { ecmaVersion: 2020 });

// Locate the _$_I function
let vmInterpreter = null;
walk.simple(ast, {
    FunctionDeclaration(node) {
        if (node.id && node.id.name === '_$_I') vmInterpreter = node;
    }
});

// Extract all opcode branches
const opcodes = {};
walk.simple(vmInterpreter, {
    IfStatement(node) {
        if (node.test.type === 'BinaryExpression' &&
            node.test.operator === '===' &&
            node.test.right.type === 'Literal' &&
            typeof node.test.right.value === 'number') {
            const opNum = node.test.right.value;
            const bodySrc = code.substring(node.consequent.start, node.consequent.end);
            if (!opcodes[opNum]) {
                opcodes[opNum] = bodySrc.replace(/\s+/g, ' ').trim();
            }
        }
    }
});

fs.writeFileSync('opcodes.json', JSON.stringify(opcodes, null, 2));
// Output: 409 entries (including nested branches)
```

Example output:

```json
{
    "0": "{ _$eW = _$cR[_$gH._$hn[++_$bh]]; }",
    "1": "{ _$eW = _$gH._$eR[_$gH._$hn[++_$bh]]; }",
    "2": "{ _$eW = !_$eW; }",
    "6": "{ _$eW = _$eW[_$cR[_$gH._$hn[++_$bh]]]; }",
    "8": "{ var _$fc = _$gH._$hn[++_$bh]; _$eW = _$eW(_$fc ? ... }",
    "12": "{ _$eW = _$c1; _$c1 = []; }",
    "54": "{ _$eW = _$eW.apply(null, ...); }"
}
```

### Step 2: Disassemble Bytecode → assembly

**Input**: r2mka_parsed.json (bytecode of 407 functions) + opcodes.json
**Output**: disasm_output.txt (6328 lines of assembly)

Convert each function's bytecode array into human-readable assembly instructions:

```javascript
function disasm(bc) {
    const lines = [];
    let pc = 0;
    while (pc < bc.length) {
        const op = bc[pc];
        const startPc = pc;
        let instr = '';
        switch (op) {
            case 0: instr = 'arg(' + bc[++pc] + ')'; pc++; break;
            case 1: instr = 'eW=G(' + bc[++pc] + ')'; pc++; break;
            case 2: instr = '!'; pc++; break;
            case 3: instr = 'SET'; pc++; break;
            case 5: instr = 'SPROP(' + bc[++pc] + ')'; pc++; break;
            case 6: instr = '.s(' + bc[++pc] + ')'; pc++; break;
            case 7: instr = '-'; pc++; break;
            case 8: instr = 'CALL(' + bc[++pc] + ')'; pc++; break;
            case 9: instr = 'ETRY'; pc++; break;
            case 10: instr = 'ECATCH'; pc++; break;
            case 11: instr = 'K(' + bc[++pc] + ')'; pc++; break;
            case 12: instr = 'eW=c1; c1=[]'; pc++; break;
            case 13: instr = 'c1.push(eW)'; pc++; break;
            // ... 114 opcodes total
        }
        lines.push(pc.toString().padStart(4) + ': ' + instr);
    }
    return lines;
}
```

Example output (child[40], Cookie S TLV parser):

```
   0: arg(0)
   2: eW=G(0)
   4: .s(18)      // .length
   6: eW=G(0)
   8: K(67)        // rt[67] constant table
  10: .s(0)        // [0] = 131072
  12: >>>
  14: K(67)
  16: .s(7)        // [7] = 127
  18: &
  20: SET var(0)
```

### Step 3: Stack Simulation → Pseudo JS

**Input**: disasm_output.txt + string_tables.json (variable-name / string mappings)
**Output**: pseudo_js.txt (1653 lines of readable JS)

Simulate the VM's stack operations, converting assembly instructions into expressions:

```javascript
function translateBytecode(bc, funcName) {
    const stack = [];
    const lines = [];
    let pc = 0;

    function push(expr) { stack.push(expr); }
    function pop() { return stack.length ? stack.pop() : '/*empty*/'; }
    function emit(code) { lines.push('    ' + code); }

    while (pc < bc.length) {
        const op = bc[pc];
        switch(op) {
            case 0: push('arg' + bc[++pc]); pc++; break;           // argument reference
            case 1: push('G[' + bc[++pc] + ']'); pc++; break;      // global variable
            case 5: {                                                // property assignment
                const n = bc[++pc]; const val = pop(); const obj = peek();
                emit(obj + '.' + g72[n] + ' = ' + val + ';');
                pc++; break;
            }
            case 8: {                                                // function call
                const argc = bc[++pc]; const args = [];
                for (let i = 0; i < argc; i++) args.unshift(pop());
                const fn = pop();
                push(fn + '(' + args.join(', ') + ')');
                pc++; break;
            }
            // ...
        }
    }
    return lines;
}
```

Example output:

```javascript
function child40_tlvParser(cookieS_bytes) {
    var len = (cookieS_bytes.length >>> 0) & 127;
    var pos = 0;
    while (pos < len) {
        var type = sliceRead(cookieS_bytes, pos);
        var blockLen = sliceRead(cookieS_bytes, pos);
        var block = cookieS_bytes.slice(pos, pos + blockLen);
        // ... TLV parsing logic
    }
}
```

### Step 4: Manual Semantic Annotation

**Input**: pseudo_js.txt + data-driven comparison results
**Output**: complete semantic understanding + algorithm documentation

The code auto-translated by AST lacks variable semantics. Annotate it as follows:

1. **Constant-table lookup**: `rt[67][28] = 45` → this is the weight for byte=0 in the Huffman weights
2. **String-table lookup**: `g72[18] = "length"`, `g72[16] = "cookie"`
3. **Function-signature comparison**: the body of `rt[129]` contains `0x67452301` → SHA-1 initialization constant
4. **Data-flow tracing**: the complete path from the Cookie S input to the 49B session output

---

## AST vs Runtime Tracing: Comparison

| Dimension | Runtime Tracing (detour) | AST Static Analysis (optimal) |
|------|-------------------|---------------------|
| Prerequisites | Requires sdenv/browser able to run eval code | Only needs the eval_code.js text file |
| Source of opcodes | Hook the while(1) loop and record one by one | Extract all at once in a single AST parse |
| Coverage | Can only cover the current execution path | Covers all branches, 100% of opcodes |
| Speed | ~80 bytecodes/day (manual tracing) | ~400 bytecodes/hour (batch translation) |
| Reusability | Must re-hook on every run | Script is reusable, only needs variable-name adaptation |
| Accuracy | Affected by runtime state, may miss cases | Precise down to each AST node |
| Efficiency ratio | Baseline (1x) | **~80x** |

Key conclusion: runtime tracing is suited to discovering entry points and validating hypotheses, while AST is suited to batch extraction and systematic analysis. Combining the two works best: first use runtime tracing (Step 1-22) to build an overall understanding, then use AST to systematically extract all the details.

---

## rt[] Function Registration Mechanism

The eval code contains one key large push statement:

```javascript
Array.prototype.push.apply(_$cR, [func1, func2, func3, ...]);
// _$cR = rt array
// Registers 440+ functions at once into rt[56] ~ rt[495]
```

AST extraction method:

```javascript
// Locate the push.apply call
const pushStart = code.indexOf("_$cR.push(") + "_$cR.push(".length;

// Split arguments by top-level commas
let depth = 0, args = [], current = '';
for (let i = pushStart; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
    }
    else if (c === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
    }
    current += c;
}

const RT_BASE = 56; // rt[0..55] is already filled before the push
// args[0] → rt[56], args[1] → rt[57], ...
// args[N] is a function name or an inline function
```

Each `rt[N]` corresponds to a specific function, for example:

| rt index | Function name | Functionality |
|---------|--------|------|
| rt[5] | String.split | String splitting |
| rt[64] | String table g68 | Property-name mapping |
| rt[67] | Constant table | Numeric constant array |
| rt[75] | Cookie reader | Reads document.cookie |
| rt[113] | sliceRead | Variable-length byte read |
| rt[129] | hashFunc | SHA-1 hash |
| rt[146] | huffmanDecode | Huffman decoding |
| rt[157] | xorInPlace | Byte XOR |
| rt[239] | _$bs | Suffix generator (15KB) |

---

## The Discovery of SHA-1 (Not XTEA/AES)

### Background

It was initially assumed that the suffix signature used XTEA (because the XTEA constant `0x9E3779B9 = 2654435769` appears in the eval code) or AES (because Cookie encryption uses AES).

### AST Localization Process

```javascript
// Search for the XTEA delta constant
var xteaPos = code.indexOf("2654435769");
// Found! But tracing the call chain revealed: XTEA is only used for Cookie S decryption, not for the suffix signature

// Search for the SHA-1 initialization constants
var sha1Constants = ["1732584193", "4023233417", "2562383102", "271733878", "3285377520"];
sha1Constants.forEach(c => {
    var pos = code.indexOf(c);
    // All found! Inside the rt[129] function
});
```

### Conclusion

- **Cookie S decryption**: XTEA (Tea-CBC mode)
- **Cookie T encryption**: AES-128-CBC
- **Suffix signature**: SHA-1 (not XTEA, not AES)
- **CRC32**: used for data checksums and basearr fields (UA, pathname)

This discovery corrected the earlier incorrect assumption about the encryption algorithms.

---

## createElement('a') URL Parsing Trace

### Problem

Suffix generation needs to extract components such as pathname/search from the current URL. The VM does not directly use `new URL()` or the `location` object; instead it uses a clever approach.

### AST Discovery

Inside rt[239] (`_$bs`, the suffix generation function, 15KB) the following was found:

```javascript
// VM creates an <a> element, sets href, then reads pathname/search
var a = document.createElement('a');
a.href = targetUrl;
var pathname = a.pathname;   // parsed automatically
var search = a.search;       // parsed automatically
var hostname = a.hostname;   // parsed automatically
```

This is the standard DOM URL-parsing trick: the href attribute of an `<a>` element is automatically parsed by the browser into the complete set of URL components.

### Significance

In an sdenv/jsdom environment, `document.createElement('a')` must support URL parsing correctly, otherwise suffix generation will fail. This explains why certain simplified DOM mocks cannot run the suffix logic correctly.

---

## The 14 AST Tool Scripts

| No. | Script | Functionality | Input | Output | Time |
|------|------|------|------|------|------|
| 1 | ast_extract_opcodes.js | Extract 114 opcodes from _$_I | eval_code.js | opcodes.json (409 entries) | 2h |
| 2 | ast_verify_all.js | Verify the 440 rt[] mappings | eval_code.js | rt_map.json | 1h |
| 3 | ast_deep_bs.js | In-depth analysis of the rt[239] suffix generator | eval_code.js + rt239_source.js | Call chain + key functions | 3h |
| 4 | ast_trace_rt239.js | Trace the complete sub-functions of rt[239] | eval_code.js | Function source set | 2h |
| 5 | ast_trace_session49.js | Trace Cookie S → 49B session | eval_code.js | Decryption call chain | 2h |
| 6 | ast_find_xtea_huffman.js | Locate XTEA/Huffman/SHA-1 | eval_code.js | Algorithm function locations | 1h |
| 7 | ast_trace_49b.js | Trace the 49B session data flow | eval_code.js | Data-flow graph | 2h |
| 8 | ast_session_chain.js | Complete Cookie S decryption chain | eval_code.js | Recursive call chain | 2h |
| 9 | ast_cookie_s_decrypt.js | Cookie S decryption path | eval_code.js | AES/XTEA localization | 1.5h |
| 10 | ast_cookie_s_complete.js | Complete Cookie S processing | eval_code.js | End-to-end flow | 2h |
| 11 | ast_r2mka_disasm.js | r2mKa bytecode disassembly | r2mka_parsed.json | 6328 lines of assembly | 3h |
| 12 | ast_bytecode_to_js.js | Bytecode → pseudo JS (stack simulation) | r2mka_parsed.json | 1653 lines of pseudo JS | 4h |
| 13 | ast_translate_child40.js | Translate the Cookie S TLV parser | r2mka_parsed.json | Readable JS function | 2h |
| 14 | ast_suffix_structure.js | Suffix 88B/120B structure analysis | rt239_source.js | URL encoding flow | 3h |

About 30 hours in total. Compared with the time required by the runtime-tracing approach (22 steps over roughly 2 weeks), the AST approach is significantly more efficient in the systematic-analysis phase.

---

## Boundaries of AST Applicability

### Scenarios Suited to AST

- Extracting all opcode implementations of the VM interpreter
- Building the rt[] function mapping table
- Locating specific algorithms (via constant search)
- Batch disassembly of bytecode
- Tracing function call chains (static analysis)
- Understanding code structure and control flow

### Scenarios Not Suited to AST

- Determining the concrete values of basearr → use data-driven comparison
- Data generated dynamically at runtime → collect via hooking
- Logic requiring actual execution to verify → run with sdenv
- Highly dynamic branch selection → runtime tracing is more direct

### Best Practices

```
1. First use runtime tracing (VM Hook) to build an overall understanding: entry, exit, data pipeline
2. Then use AST for systematic extraction: opcode table, function mapping, algorithm localization
3. Finally use data-driven analysis to fill in the dynamic parts AST cannot cover: basearr field values
```

The three are complementary and all indispensable. AST is the most efficient stage, but it cannot replace data-driven verification.
