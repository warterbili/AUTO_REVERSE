# Stage 3: Outer VM Rewrite (Generic, One-Time)

## Core Idea

Do not run the VM — rewrite the VM. mainjs is a deterministic code generator that depends on only 3 inputs (nsd, cd, globalText1). Once the algorithm is understood, rewrite it in pure JS to recover all intermediate data.

## Input/Output

- Input: mainjs source + nsd + cd
- Output: eval code (100% byte-identical) + functionsNameSort + mainFunctionIdx + keynameNum
- Verification criterion: Coder output === eval output of vm.runInContext(mainjs), byte-for-byte identical

## Reverse-Engineering Method (9 Steps)

### Step 1: Read the rs-reverse source, build a module mapping table

Using the rs-reverse Coder.js source (335 lines) as reference, understand the architecture:

| rs-reverse module | Corresponding mainjs function | Function |
|----------------|-----------------|------|
| getScd.js | _$ad() (usually line 12) | PRNG: 15679 * (seed & 0xFFFF) + 2531011 |
| globaltext.js | _$$1() + _$kx (line 77) | Reads charCode from the encoded string |
| arraySwap.js | _$lT() (line 21) | Fisher-Yates shuffle |
| grenKeys.js | Internal variable-name generation | 918 variable names in _$xx format |
| Coder.js | _$cj() (line 70) | Core code generator (75 opcodes) |
| Coder.gren() | _$g6() (line 371) | Code-segment generation (55 opcodes) |

### Step 2: Format mainjs, build a variable table

```bash
npx js-beautify mainjs.js -o mainjs_fmt.js
```

Variable table (names differ each time, roles are fixed):

| mainjs variable | Meaning | rs-reverse counterpart |
|-------------|------|----------------|
| _$kx | globalText encoded string | immucfg.globalText1 |
| _$jL | Cursor position | optext cursor |
| _$cN | keycodes array | this.keycodes |
| _$aB | keynames variable-name table (918) | this.keynames / cp[1] |
| _$ft | Code-fragment array | codeArr |
| _$_1 | nsd value | $_ts.nsd |

### Step 3: Extract the 75 opcodes of the first-layer VM

From mainjs_fmt.js lines 95-370, key opcodes:

- op 20: read nsd
- op 49: set globalText1
- op 53: variable-name character set
- op 75: grenKeys(0, 918, scd(nsd))
- op 46: shuffle variable names
- op 88: getLine(getCode()*55295+getCode()) - keycodes/r2mka
- op 76: concatenate eval code
- op 85: eval.call(window, code)

### Step 4: Extract the 55 opcodes of the second-layer VM

mainjs_fmt.js lines 371-700, key ones:

- op 34: getList (recursively reads sub-lists)
- op 36: getLine
- op 60: arrayShuffle

### Step 5: Understand the call hierarchy of the two-layer VM

```
_$cj(56) -> main initialization
  |-- _$cj(0, 918, prng) -> variable-name generation
  |-- _$g6(36, ...) -> code-segment generation
  |   |-- _$g6(34, len) -> getLine
  |   +-- _$g6(48, ...) -> code-segment loop
  +-- eval(code) -> execute generated code
```

### Step 6: Implement the 5 core modules

1. PRNG (createScd) - 3 lines
2. Fisher-Yates shuffle (arrayShuffle) - 5 lines
3. Cursor reader (textReader) - 10 lines
4. Variable-name generation (grenKeys) - 6 lines
5. String extraction (extractImmucfg) - 10 lines

### Step 7: Implement the Coder class

The core class combines the 5 modules above, parses globalText1 according to the parseGlobalText1 sequence, calls _gren segment by segment to generate code, and finally concatenates everything into the complete eval code.

### Step 8: Byte-by-byte comparison debugging (critical!)

This is the most time-consuming step. In practice it went through 3 versions:

- v1: off by 42K characters; the very first variable name was already wrong
- v2: fixed 3 bugs -> first 51% matches
- v3: fixed 3 more bugs -> gap narrowed to 180 characters
- Finally: debugger alignment -> 100% match

### Step 9: Extract intermediate data

Once Coder matches, it automatically yields: functionsNameSort, mainFunctionIdx, r2mkaText, keynameNum

## Core Algorithms

### PRNG

```javascript
function createScd(seed) {
    let s = seed;
    return () => { s = 15679 * (s & 0xFFFF) + 2531011; return s; };
}
```

### Fisher-Yates Shuffle

```javascript
function arrayShuffle(arr, scd) {
    const a = [...arr];
    let len = a.length;
    while (len > 1) { len--; const i = scd() % len; [a[len], a[i]] = [a[i], a[len]]; }
    return a;
}
```

### Variable-Name Generation

```javascript
function grenKeys(num, nsd) {
    const chars = '_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const names = [];
    for (let i = 0; i < chars.length && names.length < num; i++)
        for (let j = 0; j < chars.length && names.length < num; j++)
            names.push('_$' + chars[i] + chars[j]);
    return arrayShuffle(names, createScd(nsd));
}
```

### Extracting Static Data from mainjs

Find all quoted strings in mainjs, take the 4 longest, and sort them by length:

globalText1 (longest) -> cp0 -> cp2 -> globalText2

### extractImmucfg Escape Handling (Critical Detail)

```javascript
function extractImmucfg(code) {
    const q = [];
    for (let i = 0; i < code.length; i++)
        if (code[i] === '"' && (i === 0 || code[i-1] !== '\\')) q.push(i);
    const strs = [];
    for (let i = 0; i < q.length - 1; i += 2) {
        const raw = code.slice(q[i]+1, q[i+1]);
        try {
            strs.push(JSON.parse('"'+raw+'"'));
        } catch(e) {
            try { strs.push(new Function('return "' + raw + '"')()); }
            catch(e2) { strs.push(raw); }
        }
    }
    strs.sort((a,b) => b.length - a.length);
    return { globalText1: strs[0], cp0: strs[1], cp2: strs[2], globalText2: strs[3] };
}
```

### Text Reader

```javascript
function textReader(text) {
    let c = 0;
    return {
        getCode() { return text.charCodeAt(c++); },
        getLine(n) { const s = text.substr(c, n); c += n; return s; },
        getList() {
            const n = text.charCodeAt(c);
            const d = [];
            for (let i = 0; i < n; i++) d.push(text.charCodeAt(c+1+i));
            c += n + 1;
            return d;
        },
    };
}
```

### parseGlobalText1 Core Sequence

```
6 x getCode()                           -> opmate flags (6)
getLine(getCode()*55295 + getCode())     -> keycodes string
1 x getCode()                           -> separator
getLine(getCode()*55295 + getCode())     -> r2mkaText
1 x getCode()                           -> code-segment count codeNum
for (i=0; i<codeNum; i++) -> _gren(i)   -> generate code segment
```

### _gren Code-Segment Generation (Full Detail)

Meaning of the 8 opmates:

| Index | Variable | Meaning |
|------|------|------|
| 0 | ku | identifier |
| 1 | s6 | var declaration |
| 2 | bs | conditional test |
| 3 | sq | wrapper parameter |
| 4 | jw | while condition |
| 5 | sg | apply target |
| 6 | cu | current segment name |
| 7 | aw | global opmate |

Read 3 lists:

- listK: function parameters
- listH: variable declarations
- listC: wrapper pairings

### _ifElse Binary-Search Dispatch

Step table: `[4, 16, 64, 256, 1024, 4096, 16384, 65536]`

Perform a binary search over the opcodes by step size, generating a nested if-else structure that turns the linear opcode list into efficient dispatch logic.

### parseGlobalText2

```javascript
parseGlobalText2() {
    const r = textReader(this.globalText2);
    r.getCode();
    const kcStr = r.getLine(r.getCode());
    const kc2 = kcStr.split(String.fromCharCode(257));
    const list = r.getList();
    const out = [];
    for (let i = 0; i < list.length - 1; i += 2)
        out.push(kc2[list[i]], this.keynames[list[i+1]]);
    out.push(kc2[list[list.length - 1]]);
    return out.join('');
}
```

### keynameNum Dynamic Extraction

```javascript
const m = mainjs.match(/_\$[\$_A-Za-z0-9]{2}=_\$[\$_A-Za-z0-9]{2}\(0,([0-9]+),/);
const keynameNum = m ? parseInt(m[1]) : 918;
```

### codeUid Computation

```javascript
function computeCodeUid(coder, keys) {
    const funcIdx = parseInt(String.fromCharCode(...keys[33]));
    const sliceMul = parseInt(String.fromCharCode(...keys[34]));
    const func = coder.functionsNameSort[funcIdx];
    if (!func) return 0;
    const mainCode = coder.code.slice(...coder.mainFunctionIdx);
    const one = crc32(func.code);
    const len = Math.floor(mainCode.length / 100);
    const two = crc32(mainCode.substr(len * sliceMul, len));
    return (one ^ two) & 65535;
}
```

## 6 Pitfalls Discovered During Debugging (Real Experience)

1. **opmate count**: the global opmates are 5 named + 1 unnamed = 6 (not 7)
2. **gren(0) arguments**: use the global G_$dK/G_$kv, not the local opmate
3. **var declaration variable**: use opmate index 1 (_$$6), not index 2 (_$b$)
4. **while(1) loop**: also uses the global opmate
5. **_ifElse recursion**: the start variable is modified inside the for loop; the else branch uses the modified start
6. **debugger PRNG**: rebuilt for each gren segment (seed=nsd); the posis array accumulates across segments
