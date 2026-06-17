/**
 * Outer VM rewriter -- implemented from analysis of mainjs _$cj (75 opcodes) + _$g6 (55 opcodes)
 * Verified: eval code is 100% byte-identical
 *
 * Input:  mainjs source + nsd + cd
 * Output: eval code + r2mkaText + keycodes + keynames + aebi + functionsNameSort + cp3
 */
const fs = require('fs');
const path = require('path');

// ============================================================
// PRNG (mainjs _$ad, line 12)
// Linear congruential generator; seed comes from nsd
// ============================================================
function createScd(seed) {
    let s = seed;
    return () => {
        s = 15679 * (s & 0xFFFF) + 2531011;
        return s;
    };
}

// ============================================================
// Fisher-Yates shuffle (mainjs _$lT, line 21)
// Deterministic shuffle driven by the PRNG; the same seed yields the same result
// ============================================================
function arrayShuffle(arr, scd) {
    const a = [...arr];
    let len = a.length;
    while (len > 1) {
        len--;
        const i = scd() % len;
        [a[len], a[i]] = [a[i], a[len]];
    }
    return a;
}

// ============================================================
// Extract the 4 longest quoted strings from mainjs
// After sorting by length they are: globalText1, cp0, cp2, globalText2
// ============================================================
function extractImmucfg(code) {
    // Find the positions of all non-escaped double quotes
    const q = [];
    for (let i = 0; i < code.length; i++) {
        if (code[i] === '"' && (i === 0 || code[i - 1] !== '\\')) {
            q.push(i);
        }
    }

    // Pair up quotes two at a time and extract the string between them
    const strs = [];
    for (let i = 0; i < q.length - 1; i += 2) {
        const raw = code.slice(q[i] + 1, q[i + 1]);
        try {
            strs.push(JSON.parse('"' + raw + '"'));
        } catch (e) {
            try {
                strs.push(eval('("' + raw + '")'));
            } catch (e2) {
                strs.push(raw);
            }
        }
    }

    // Sort by length descending and take the first 4
    strs.sort((a, b) => b.length - a.length);

    return {
        globalText1: strs[0],
        cp0:         strs[1],
        cp2:         strs[2],
        globalText2: strs[3],
    };
}

// ============================================================
// Variable name generation (mainjs op 53+21+46)
// Generate _$XX-format variable names, then shuffle them with the PRNG
// ============================================================
function grenKeys(num, nsd) {
    const chars = '_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const names = [];
    for (let i = 0; i < chars.length && names.length < num; i++) {
        for (let j = 0; j < chars.length && names.length < num; j++) {
            names.push('_$' + chars[i] + chars[j]);
        }
    }
    return arrayShuffle(names, createScd(nsd));
}

// ============================================================
// Cursor-based reader (mainjs _$$1 + _$kx)
// Reads data from globalText by byte / line / list
// ============================================================
function textReader(text) {
    let c = 0;
    return {
        // Read the charCode of a single character
        getCode() {
            return text.charCodeAt(c++);
        },
        // Read a substring of n characters
        getLine(n) {
            const s = text.substr(c, n);
            c += n;
            return s;
        },
        // Read a length-prefixed list (first char = length, rest = data)
        getList() {
            const n = text.charCodeAt(c);
            const d = [];
            for (let i = 0; i < n; i++) {
                d.push(text.charCodeAt(c + 1 + i));
            }
            c += n + 1;
            return d;
        },
        // Current position
        pos() {
            return c;
        },
    };
}

// ============================================================
// Coder class -- core rewrite engine
// ============================================================
class Coder {
    constructor(nsd, cd, mainjsCode) {
        const imm = extractImmucfg(mainjsCode);
        this.globalText1 = imm.globalText1;
        this.globalText2 = imm.globalText2;
        this.cp0 = imm.cp0;
        this.cp2 = imm.cp2;
        this.nsd = nsd;
        this.cd = cd;

        // Extract the variable name count from mainjs (usually 918)
        const knMatch = mainjsCode.match(
            /_\$[\$_A-Za-z0-9]{2}=_\$[\$_A-Za-z0-9]{2}\(0,([0-9]+),_\$[\$_A-Za-z0-9]{2}\(/
        );
        this.keynameNum = knMatch ? parseInt(knMatch[1]) : 918;

        this.keynames = grenKeys(this.keynameNum, nsd);
        this.keycodes = [];
        this.scd = createScd(nsd);
        this.aebi = [];
        this.r2mkaText = null;
        this.functionsNameSort = [];
        this.mainFunctionIdx = null;
        this.code = '';
        this.cp3 = 0;

        // debugger-related
        this.hasDebug = true;
        this._debuggerScd = null;
        this._debuggerPosi = [];
    }

    // ----------------------------------------------------------
    // run: main entry point, generates the complete eval code
    // ----------------------------------------------------------
    run() {
        const codeArr = this.parseGlobalText1();
        codeArr.push(this.parseGlobalText2());
        codeArr.push("})(", '$_ts', ".scj,", '$_ts', ".aebi);");
        this.code = codeArr.join('');

        // cp3 = mainjs checksum (sum of charCode taken every 100 characters)
        let h = 0;
        for (let i = 0; i < this.code.length; i += 100) {
            h += this.code.charCodeAt(i);
        }
        this.cp3 = h;

        return this;
    }

    // ----------------------------------------------------------
    // parseGlobalText1: parse the main text and generate all code segments
    // ----------------------------------------------------------
    parseGlobalText1() {
        const r = textReader(this.globalText1);
        const { scd, keynames } = this;
        const codeArr = [];

        // Read the 6 global opmates
        this._globalMates = {};
        this._globalMates.G_e4 = r.getCode();
        this._globalMates.G_sc = r.getCode();
        this._globalMates.G_dK = r.getCode();
        this._globalMates.G_kv = r.getCode();
        this._globalMates.G_cR = r.getCode();
        this._globalMates.G_un = r.getCode();

        // keycodes string (separated by 257)
        const kLen = r.getCode() * 55295 + r.getCode();
        const kcStr = r.getLine(kLen);
        this.keycodes.push(...kcStr.split(String.fromCharCode(257)));

        // r2mka text
        r.getCode(); // separator
        const rLen = r.getCode() * 55295 + r.getCode();
        const r2mkaRaw = r.getLine(rLen);
        this.keycodes.push(r2mkaRaw);
        this.r2mkaText = this._parseR2mka(r2mkaRaw);

        // Iterate over all code segments
        const codeNum = r.getCode();
        for (let current = 0; current < codeNum; current++) {
            // Rebuild the debugger PRNG for each gren segment
            if (this.hasDebug) {
                const dScd = createScd(this.nsd);
                let dMax = dScd() % 10 + 10;
                this._debuggerScd = (posi) => {
                    let ret = false;
                    --dMax;
                    if (dMax <= 0) {
                        dMax = dScd() % 10 + 10;
                        if (dMax < 64) {
                            ret = true;
                            this._debuggerPosi.push(posi);
                        }
                    }
                    return ret;
                };
            }
            this._gren(r, current, codeArr);
        }

        // Closing braces
        codeArr.push('}}}}}}}}}}'.substr(codeNum - 1));
        if (this.mainFunctionIdx) {
            this.mainFunctionIdx.push(codeArr.join('').length);
        }

        return codeArr;
    }

    // ----------------------------------------------------------
    // _parseR2mka: extract the content inside the quotes from the raw string
    // ----------------------------------------------------------
    _parseR2mka(raw) {
        const s = raw.indexOf('"') + 1;
        const e = raw.lastIndexOf('"');
        if (s <= 0 || e <= s) return null;

        const inner = raw.substring(s, e);
        try {
            return JSON.parse('"' + inner + '"');
        } catch (err) {
            try {
                return eval('("' + inner + '")');
            } catch (err2) {
                return inner;
            }
        }
    }

    // ----------------------------------------------------------
    // _gren: generate a single code segment (function)
    // ----------------------------------------------------------
    _gren(r, current, codeArr) {
        const { scd, keynames, keycodes } = this;

        // Random newlines (0-4)
        codeArr.push('\n\n\n\n\n'.substring(0, scd() % 5));

        // Read the 8 local opmates
        const m = {};
        for (const k of ['ku', 's6', 'bs', 'sq', 'jw', 'sg', 'cu', 'aw']) {
            m[k] = r.getCode();
        }

        // Read the 3 lists
        const listK = r.getList();  // extra parameter list
        const listH = r.getList();  // local variable list
        const listC = r.getList();  // wrapper function pairs

        // Pair up listC entries, then shuffle
        const pairs = [];
        for (let i = 0; i < listC.length; i += 2) {
            pairs.push([listC[i], listC[i + 1]]);
        }
        const shuffledPairs = arrayShuffle(pairs, scd);

        // Read the opcode range upper bound
        const bf = r.getCode();

        // Read aebi (bytecode of the current segment)
        const aebiData = r.getList();
        this.aebi[current] = aebiData;

        // Read the function code segments
        const funcCount = r.getCode();
        const funcSegs = [];
        for (let i = 0; i < funcCount; i++) {
            funcSegs.push(r.getList());
        }
        const shuffledFuncs = arrayShuffle(funcSegs, scd);

        // Read the opcode implementations
        const opcCount = r.getCode();
        const opcImpls = [];
        for (let i = 0; i < opcCount; i++) {
            opcImpls.push(r.getList());
        }

        // ---- Function header ----
        if (current > 0) {
            // Regular function declaration
            if (!this.mainFunctionIdx) {
                this.mainFunctionIdx = [codeArr.join('').length];
            }
            codeArr.push("function ", keynames[m.jw], "(", keynames[m.s6]);
            listK.forEach(it => codeArr.push(",", keynames[it]));
            codeArr.push("){");
        } else {
            // Segment 0: IIFE, uses the global opmates
            codeArr.push(
                "(function(", keynames[this._globalMates.G_dK],
                ",", keynames[this._globalMates.G_kv],
                "){var ", keynames[m.s6], "=0;"
            );
        }

        // ---- Wrapper functions ----
        const fnMap = {};
        shuffledPairs.forEach(([k1, k2]) => {
            const a = [
                "function ", keynames[k1],
                "(){var ", keynames[m.sq],
                "=[", k2,
                "];Array.prototype.push.apply(", keynames[m.sq],
                ",arguments);return ", keynames[m.sg],
                ".apply(this,", keynames[m.sq], ");}"
            ];
            codeArr.push(...a);
            fnMap[keynames[k1]] = a.join('');
        });

        // ---- Function code segments ----
        shuffledFuncs.forEach(item => {
            for (let i = 0; i < item.length - 1; i += 2) {
                codeArr.push(keycodes[item[i]], keynames[item[i + 1]]);
            }
            codeArr.push(keycodes[item[item.length - 1]]);
        });

        // ---- Local variable declarations ----
        if (listH.length) {
            listH.forEach((it, i) => {
                codeArr.push(i ? "," : 'var ', keynames[it]);
            });
            codeArr.push(';');
        }

        // ---- while(1) dispatch loop ----
        codeArr.push(
            "var ", keynames[m.bs], ",", keynames[m.cu], ",",
            keynames[m.ku], "=", keynames[m.s6], ",",
            keynames[m.aw], "=", keynames[this._globalMates.G_kv],
            "[", current, "];"
        );
        codeArr.push(
            "while(1){",
            keynames[m.cu], "=", keynames[m.aw], "[", keynames[m.ku], "++];"
        );
        codeArr.push("if(", keynames[m.cu], "<", bf, "){");

        // ---- functionsSort (stages 1-4) ----
        if ([1, 2, 3, 4].includes(current)) {
            try {
                this._functionsSort(current, fnMap, shuffledPairs, opcImpls, aebiData);
            } catch (e) {
                /* ignore */
            }
        }

        // ---- if/else binary dispatch tree ----
        this._ifElse(0, bf, codeArr, opcImpls, keycodes, keynames, keynames[m.cu]);

        codeArr.push("}else ", ';', '}');
    }

    // ----------------------------------------------------------
    // _functionsSort: extract function name ordering info (for later hooking)
    // ----------------------------------------------------------
    _functionsSort(current, fnMap, pairs, opcImpls, aebi) {
        const { keynames, keycodes } = this;
        const len = pairs.length;

        const getName = (idx) => {
            const arr = opcImpls[idx];
            if (!arr || arr.length !== 5 || !fnMap[keynames[arr[3]]]) {
                throw new Error();
            }
            return keynames[arr[3]];
        };

        let start = 0;
        if (current === 1) {
            // Find the starting offset within keycodes
            this.keycodes
                .filter(it => typeof it === 'string' && /^\([0-9]+\);$/.test(it))
                .forEach(it => {
                    const s = parseInt(it.slice(1));
                    if (s + len > aebi.length) return;
                    try {
                        aebi.slice(s, s + len).forEach(getName);
                    } catch (e) {
                        return;
                    }
                    start = s;
                });
        }

        aebi.slice(start, start + len).forEach(idx => {
            const name = getName(idx);
            if (name) {
                this.functionsNameSort.push({ name, current, code: fnMap[name] });
            }
        });
    }

    // ----------------------------------------------------------
    // _ifElse: recursively generate the if/else binary dispatch tree
    // Divide-and-conquer the opcode range [start, end) into leaf nodes of size <= 4
    // ----------------------------------------------------------
    _ifElse(start, end, out, impls, kc, kn, cuName) {
        const arr8 = [4, 16, 64, 256, 1024, 4096, 16384, 65536];
        let diff = end - start;

        if (diff === 0) {
            return;
        } else if (diff === 1) {
            // Leaf: single opcode
            this._appendImpl(start, out, impls, kc, kn);
        } else if (diff <= 4) {
            // Leaf: 2-4 opcodes, emit if/else one by one
            let text = "if(";
            end--;
            for (; start < end; start++) {
                out.push(text, cuName, "===", start, "){");
                this._appendImpl(start, out, impls, kc, kn);
                text = "}else if(";
            }
            out.push("}else{");
            this._appendImpl(start, out, impls, kc, kn);
            out.push("}");
        } else {
            // Divide and conquer: split by step
            const step = arr8[arr8.findIndex(it => diff <= it) - 1] || 0;
            let text = "if(";
            for (; start + step < end; start += step) {
                out.push(text, cuName, "<", start + step, "){");
                this._ifElse(start, start + step, out, impls, kc, kn, cuName);
                text = "}else if(";
            }
            out.push("}else{");
            this._ifElse(start, end, out, impls, kc, kn, cuName);
            out.push("}");
        }
    }

    // ----------------------------------------------------------
    // _appendImpl: emit the implementation code for a single opcode
    // ----------------------------------------------------------
    _appendImpl(idx, out, impls, kc, kn) {
        // Randomly insert debugger statements (anti-debugging)
        if (this._debuggerScd?.(out.length)) {
            out.push('debugger;');
        }

        const arr = impls[idx];
        if (!arr) return;

        // Alternately emit keycode + keyname
        const len = arr.length - (arr.length % 2);
        for (let i = 0; i < len; i += 2) {
            out.push(kc[arr[i]], kn[arr[i + 1]]);
        }
        // Append the final keycode when the length is odd
        if (arr.length !== len) {
            out.push(kc[arr[len]]);
        }
    }

    // ----------------------------------------------------------
    // parseGlobalText2: parse the second text segment (trailing code)
    // ----------------------------------------------------------
    parseGlobalText2() {
        const r = textReader(this.globalText2);
        r.getCode(); // skip the first byte
        const kcStr = r.getLine(r.getCode());
        const kc2 = kcStr.split(String.fromCharCode(257));
        const list = r.getList();
        const out = [];
        for (let i = 0; i < list.length - 1; i += 2) {
            out.push(kc2[list[i]], this.keynames[list[i + 1]]);
        }
        out.push(kc2[list[list.length - 1]]);
        return out.join('');
    }
}

module.exports = { Coder, extractImmucfg, grenKeys, createScd, arrayShuffle, textReader };
