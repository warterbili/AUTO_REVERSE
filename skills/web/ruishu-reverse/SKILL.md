---
name: ruishu-reverse
description: Ruishu (Rivers Security) anti-bot pure-algorithm reversing — Cookie T generation + URL suffix handling
triggers:
  - ruishu
  - rivers security
  - 412 protection
  - Cookie T
  - dynamic JS anti-bot
  - anti-bot bypass
---

# Ruishu Anti-Bot Pure-Algorithm Reversing Skill

> Goal: any Claude instance that reads this document should be able to independently produce a pure-algorithm Cookie T + URL suffix for a Ruishu-protected site.
> Validated: 9+ sites returning HTTP 200.

---

## Decision Tree

Once you have the target URL, choose an approach with this flow:

```
1. HTTP GET the target URL
   ├── Not 412 → not Ruishu protection, exit
   └── 412 + $_ts.cd + $_ts.nsd → Ruishu confirmed
       │
2. Do you only need GET requests?
   ├── Yes (80% of cases) → pure-algorithm approach [Stages 0→5]
   └── POST required
       │
3. Does the POST need a URL suffix?
   ├── No (99% of sites) → pure-algorithm Cookie + normal POST [Stages 0→5]
   └── Suffix required
       ├── Stable approach → JsRpc (browser injection, works everywhere)
       └── Lightweight approach → sdenv in-VM XHR (instance must be rebuilt after each POST)
```

**Quick check for whether a suffix is needed**: pure-algorithm Cookie T + normal POST → 200 means no suffix needed; 400/412 means a suffix is required.

---

## Protection Overview (condensed)

```
Browser GET → 412 + HTML (contains $_ts.nsd, $_ts.cd, mainjs URL, Set-Cookie: xxxS=...)
  ↓
mainjs executes → decodes cd → extracts 45 key groups + VM bytecode
  ↓
Dynamically generates ~296KB of eval code (variable names determined by the nsd seed, different every time)
  ↓
eval executes → three-layer nested VM → collects fingerprints → assembles basearr (154-166B TLV)
  ↓
basearr → Huffman → XOR → AES-CBC → CRC32 → AES-CBC → Base64 → Cookie T
  ↓
Browser re-GETs with Cookie S+T → 200
```

**The parts we replace with pure algorithm**:

| What the browser does | Pure-algorithm replacement | Stage | Details |
|-----------|---------|------|------|
| mainjs → eval code | Coder rewrite | 3 | [coder_rewrite.md](references/coder_rewrite.md) |
| cd → extract keys | extractKeys | 2 | [key_extraction.md](references/key_extraction.md) |
| VM fingerprint collection → basearr | data-driven adaptation | 4 | [basearr_adaptation.md](references/basearr_adaptation.md) |
| basearr → encryption → Cookie T | generateCookie | 1 | [encryption_chain.md](references/encryption_chain.md) |

---

## Stage Overview

| Stage | Input | Output | Validation criterion | Generic? |
|------|------|------|---------|-------|
| **0 Recon** | target URL | 412 HTML + mainjs + Cookie S + sdenv reference data | sdenv Cookie → 200 | Generic |
| **1 Encryption chain** | sdenv Cookie T + keys | `generateCookie(basearr, keys) → Cookie T` | sdenv basearr + pure-algorithm encryption → 200 | **Generic, one-time** |
| **2 Key extraction** | $_ts.cd | keys[0..44] (45 groups) | keys match those extracted by sdenv | **Generic, one-time** |
| **3 Coder** | mainjs + nsd + cd | eval code + codeUid + functionsNameSort | eval code byte-for-byte identical | **Generic, one-time** |
| **4 basearr** | reference data + keys | `buildBasearr(config, keys) → basearr` | full pure-algorithm chain → 200 | **~1h per site** |
| **5 End-to-end** | everything | pure-algorithm HTTP GET → 200 | 3+ consecutive 200s | just assemble |

**Execution order**: strictly 0 → 1 → 2 → 3 → 4 → 5; only proceed to the next step after the current one passes validation.

---

## Methodology

### Data-driven (for Cookie T / basearr — the most important!)

**Core idea**: use sdenv to collect 3-5 sets of real data → compare byte by byte → find the source of each byte. **Absolutely do not read the inner VM code** (740 states, three-layer nesting — this is a trap).

```
Collect 5 sessions → split out each TLV field → annotate byte by byte:
  Fixed (same across all sessions)        → hardcode
  From keys (matches keys[N])             → dynamic extraction
  Time-related (varies predictably)       → find the formula
  Random (no pattern)                     → Math.random
  Unknown                                 → needs more data or deeper analysis
```

**Real experience**: spending 2 days reading the VM code was a complete waste. After switching to data-driven, all problems were solved within 1 day.

### AST analysis (for URL suffix / eval code functions)

**Core idea**: the eval code is valid JS; parse the AST with acorn → build the rt[N] function map → recursively trace the call chain → extract the core algorithm. This accomplishes in a few hours what would take weeks by hand.

**Output**: 14 AST tools, ~20h, fully reversed the suffix core functions out of 296KB of obfuscated code. See [ast_methodology.md](references/ast_methodology.md) for details.

### Method Selection Table

| Which layer is the target in? | Which method to use |
|--------------|----------|
| eval code JS functions | AST (precise and efficient) |
| basearr data structures | data-driven (fast and reliable) |
| r2mKa VM bytecode | AST to extract opcodes + automatic disassembly |
| runtime dynamic values (timestamps, etc.) | sdenv collection |

---

## Pitfall Warnings (from real-world experience)

| Detour | Cost | Correct approach |
|------|------|---------|
| Decompiling the inner VM to understand basearr | **2 days wasted** | Data-driven: collect 5 sessions, solved in 10 minutes |
| Copying rs-reverse formulas (idx*7+6, etc.) | **1 day wasted** | Data-driven: formulas are version-specific, not generic |
| Patching the environment to run eval code | document.all needs a C++ addon | Coder rewrites the mainjs logic |
| Hardcoding type=2 values | wrong as soon as the session changes | cp1 index→value mapping (reverse-derived from 5 sessions) |
| Skipping hybrid verification and going straight to basearr | a 400 with no idea which step is wrong | first sdenv basearr + pure-algorithm encryption = 200, proving encryption is correct |
| Reverse-deriving opcode semantics via runtime stack tracing | 80B/day throughput | AST static extraction: 400B/hour (80x more efficient) |
| HTTP-downloading mainjs with string concatenation | UTF-8 multi-byte characters get corrupted | Buffer concatenation + toString('utf-8') |

---

## Troubleshooting Guide

### Returns 412 (Cookie not accepted)

1. Is the cookie name correct? → `keys[7].split(';')[5] + 'T'`, not hardcoded
2. Was Cookie S sent along with it? → both S and T must be sent together
3. Cookie T format? → must start with "0"
4. Has the time expired? → cookies are usually valid for < 5 minutes, check the nonce timestamp
5. Are cd and Cookie S matched? → they must come from the same 412 response

### Returns 400 (Cookie format/content error)

1. Did the encryption chain pass hybrid verification? → first validate with sdenv basearr + pure-algorithm encryption
2. Does the basearr length match? → compare against the sdenv reference (usually 154-166B)
3. Is the basearr TLV missing any fields? → compare field by field against the reference
4. Was key extraction correct? → keys[0] should be "64", keys[2] should be 48B
5. Does the POST need a URL suffix? → first confirm with an sdenv POST test

### Coder Output Mismatch

1. Compare byte by byte to find the first difference position:
   ```javascript
   for (let i = 0; i < Math.min(gen.length, ref.length); i++) {
       if (gen[i] !== ref[i]) {
           console.log('diff @' + i + ':', JSON.stringify(gen.substring(i, i+60)));
           console.log('reference:', JSON.stringify(ref.substring(i, i+60)));
           break;
       }
   }
   ```
2. The 6 common bugs:
   - opmate count: 5 named + 1 unnamed = 6 (not 7)
   - gren(0) uses the **global** opmate, not the local one
   - var declaration: uses mate index 1 (not 2)
   - while(1): also uses the **global** opmate
   - _ifElse: the start variable is modified inside the for loop, the else branch uses the modified start
   - debugger: each gren segment rebuilds PRNG(seed=nsd), posis accumulates across segments
3. Off by ~180 characters → most likely a debugger alignment issue

### Key Extraction Failure

1. Is keys[0] = "64" (ASCII [0x36, 0x34])?
   - Yes → XOR offset is correct
   - No → r2mka runTask must be implemented (high difficulty, prefer switching to another site for validation)
2. keys.length < 45 → XOR offset calculation is wrong
3. keys[29..32] are not 4B each → structural anomaly

### type=2 Value Mismatch

1. **Do not hardcode!** type=2 depends on the nsd → cp1 shuffle result
2. Collect 5 sessions, record the keys[29..32] variable names + type=2 values
3. Look up the variable name index in cp1=grenKeys(keynameNum, nsd)
4. Build a cp1_index → value mapping table (the mapping is fixed for the same mainjs version)
5. Use the script: [scripts/collect_type2.js](scripts/collect_type2.js)

---

## Site Adaptation Checklist

When adapting a new site, check off each item:

- [ ] Update HOST / PORT / PATH
- [ ] sdenv runs end-to-end → 200 (confirm it's a standard Ruishu version)
- [ ] Hybrid verification passes (sdenv basearr + pure-algorithm encryption → 200)
- [ ] flag value: read from [8..9] of the reference basearr type=7
- [ ] type=9 format: is the payload 2B `[8,0]` or 5B? read it from the reference
- [ ] type=3 structure: do the length/field count match the template? compare byte by byte
- [ ] type=2 mapping: collect 5+ sessions, build the cp1 index→value mapping
- [ ] Cookie name suffix: 'T' or 'P'? check the 412 response Set-Cookie header
- [ ] hasDebug: observe whether the eval code contains debugger statements
- [ ] keynameNum: extract from the mainjs regex (usually 918)
- [ ] End-to-end validation: 3+ consecutive 200s

---

## Quick Reference: Common Constants

```javascript
// PRNG (generic across all versions)
seed = 15679 * (seed & 0xFFFF) + 2531011

// Huffman weights (generic across all versions)
byte=0 → weight=45, byte=255 → weight=6, others → weight=1

// AES-128-CBC
outer: key=keys[16], IV=random 16B     inner: key=keys[17], IV=all-zero 16B

// CRC32 polynomial
0xEDB88320

// Custom Base64 alphabet (generic across all versions)
'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d'

// BASESTR (for cd decoding, 24 more characters than the Base64 alphabet)
'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^'

// getLine multiplier (mainjs op88)
55295

// Variable-name character set
'_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

// _ifElse binary-search step table
[4, 16, 64, 256, 1024, 4096, 16384, 65536]

// Cookie name
keys[7].split(';')[5] + 'T'

// URL suffix parameter name
keys[7].split(';')[1]
```

### Encryption Pipeline (7 steps)

```
basearr (154-166B)
  → Huffman encoding (~118B)
  → first 16 bytes XOR keys[2][0:15]
  → AES-128-CBC (key=keys[17], IV=all-zero, PKCS7)  → ~128B
  → assemble packet: [2, 8, r2mkaTime(4B), now(4B), 48, keys[2](48B), lenEnc, cipher]
  → CRC32 → [crc(4B), packet]  → ~193B
  → AES-128-CBC (key=keys[16], IV=random 16B, PKCS7)  → ~224B
  → custom Base64 → "0" + 299 characters
```

### Meaning of Key Keys

| key | Length | Meaning | Purpose |
|-----|------|------|------|
| keys[2] | 48B | KEYS48 | XOR first 16B + all 48B embedded in packet |
| keys[7] | variable | config string (semicolon-separated) | Cookie name `[5]+'T'`, suffix parameter name `[1]` |
| keys[16] | 16B | KEY2 | outer AES key |
| keys[17] | 16B | KEY1 | inner AES key |
| keys[19] | variable | timestamp string | type=10[6..9] |
| keys[21] | variable | r2mkaTime string | nonce time |
| keys[22] | variable | encrypted data | type=6 AES decryption |
| keys[24-26] | variable | numeric strings | type=10 parameters |
| keys[29-32] | 4B each | variable names | type=2 mapping (cp1 index→value) |
| keys[33-34] | variable | numeric strings | codeUid computation parameters |

---

## Variable-Name Variation Warning

**Ruishu's variable names are not fixed!** Different nsd → different grenKeys(918, nsd) shuffle → all variable names in the eval code change.

```
Session 1 (nsd=84277): _$eX, _$hR, _$cR, _$bO ...
Session 2 (nsd=91234): _$f3, _$gT, _$aK, _$dP ...
```

**Hook location must use structural features, not variable names:**
```javascript
// ❌ Wrong: using variable names (they change next time)
const target = 'function _$hr(){var _$jZ=[324];';

// ✅ Correct: using structural features (never change)
const statePattern = /function\s+(_\$\w+)\(\)\{var\s+(_\$\w+)=\[324\]/;
// ✅ Correct: using code length
if (code.length > 250000) { /* this is the eval code */ }
// ✅ Correct: using constant features
if (code.includes('15679') && code.includes('2531011')) { /* found the PRNG */ }
```

---

## Tool Dependencies

| Tool | Install | Purpose | Stage |
|------|------|------|------|
| Node.js crypto/http | built-in | AES encrypt/decrypt, HTTP requests | all |
| sdenv | `npx pnpm add sdenv` | reference data collection, in-VM XHR | 0, 4, 6 |
| js-beautify | `npm i js-beautify` | format mainjs (optional) | 3 |
| acorn + acorn-walk | `npm i acorn acorn-walk` | AST analysis (suffix reversing) | 6 |

**Note**: npm 11.x + Node 24 has a dependency-resolution infinite-loop bug; installing sdenv **must** use pnpm.
Compiling native modules requires VS Build Tools (Windows) or gcc (Linux).

---

## Companion Data Collection (core of Stage 0)

> **Ruishu's variable names differ on every load!** You must collect the full companion dataset within the **same session**.
> If you collect separately (first the 412, then the mainjs), nsd has already changed and the data won't line up!

Use [scripts/collect_session.js](scripts/collect_session.js) to collect everything at once:

```
captured/
├── session.json       nsd + cd + Cookie S/T + basearr + timestamps
├── keys_raw.json      45 key groups (index + length + data)
├── ts_init.js         $_ts initialization script (contains cd)
├── eval_code.js       296KB eval code (matching variable names)
└── mainjs.js          mainjs source (static, can be downloaded separately)
```

---

## File Index

### Detailed References (load on demand)

| File | Contents |
|------|------|
| [references/encryption_chain.md](references/encryption_chain.md) | Stage 1: complete Huffman/AES/CRC32/Base64 encryption/decryption implementation |
| [references/key_extraction.md](references/key_extraction.md) | Stage 2: cd decoding + XOR offset derivation + extraction of 45 key groups |
| [references/coder_rewrite.md](references/coder_rewrite.md) | Stage 3: outer VM rewrite + 75+55 opcodes + 9-step debugging process |
| [references/basearr_adaptation.md](references/basearr_adaptation.md) | Stage 4: TLV structure + implementation of each type + data-driven case studies |
| [references/ast_methodology.md](references/ast_methodology.md) | AST decompilation 4-step pipeline + 14 tools + method comparison |
| [references/vm_hook_cookbook.md](references/vm_hook_cookbook.md) | 7 VM injection techniques + console side-channel export |
| [references/suffix_analysis.md](references/suffix_analysis.md) | URL suffix 88B/120B structure + SHA-1 signature + existing approaches |
| [references/DEEP_DIVE.md](references/DEEP_DIVE.md) | Full end-to-end methodology long-form (3-layer VM, complete walkthrough) |

### Executable Scripts

| File | Purpose |
|------|------|
| [scripts/collect_session.js](scripts/collect_session.js) | one-shot companion data collection (sdenv + VM injection) |
| [scripts/hybrid_verify.js](scripts/hybrid_verify.js) | hybrid verification: sdenv basearr + pure-algorithm encryption → 200 |
| [scripts/pure_run.js](scripts/pure_run.js) | full pure-algorithm pipeline template (zero third-party dependencies) |
| [scripts/collect_type2.js](scripts/collect_type2.js) | type=2 multi-session collection + mapping derivation |
| [scripts/sdenv_client.js](scripts/sdenv_client.js) | sdenv client (Cookie + in-VM XHR) |

### Reference Implementations

| File | Description |
|------|------|
| [lib/coder.js](lib/coder.js) | outer VM rewriter (362 lines, validated: eval code 100% byte-identical) |
| [lib/basearr.js](lib/basearr.js) | basearr generator (304 lines, validated: HTTP 200) |
