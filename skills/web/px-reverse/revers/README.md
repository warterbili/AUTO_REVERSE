# `revers/` — PX SDK 9 Algorithm Pure-Algo Reconstruction (Node.js)

Pure JavaScript implementations of the 9 cryptographic / encoding / serialization algorithms used by PerimeterX SDK's silent Collector path. **Doesn't run the SDK, doesn't open a browser, doesn't use a V8 sandbox** — `require()` is all you need to generate / decode PX protocol data in any Node process.

## Status

| Dimension | Status |
|---|---|
| Source | Statically deobfuscated from real PX SDKs + cross-referenced with 6-batch × multi-site captures |
| Validation | Decode round-trip passes for every captured batch against the captured `main.min.js` / `init.js` |
| Combat | iFood, Grubhub, Total Wine, Academy end-to-end generators all use these 9 modules to obtain `_px3` / `_px2` |
| Cross-version | Algorithm layer hasn't moved in 3 years; these 9 modules directly reuse on every PX SDK push |

This directory is **bundled inside the `px-reverse` skill**. The skill's `scripts/` (and any generator you build) `require('../revers/...')`.

---

## 9 Modules at a Glance

| File | Default export / named exports | One-liner |
|---|---|---|
| `payload.js` | `generatePayload(events, serverTs, uuid)` | EV array → POST `payload=` string (serialize → XOR(50) → b64 → interleave) |
| `pc.js` | `generatePC(events, uuid, tag, ft)` | events + uuid + tag + ft → 16-digit pure-numeric checksum |
| `ob.js` | `processOb(json, gt)` + named `decodeOb` / `solvePow` / `ml` / `buildSid` | Collector response `.ob` segment decoding + handler dispatch |
| `sid.js` | `generateSid(pxsid, serverTs)` | Plane-14 Unicode Tag Chars steganography → POST `sid=` |
| `uuid.js` | Named `uuidV1` / `getUUID` / `resetUUID` / `setUUID` / `formatUUID` / `getRandomBytes` | RFC 4122 v1 (with PX-compatible clockseq) |
| `hash.js` | Named `generateHash` / `Kt` | djb2 variant |
| `memory.js` | Named `generateMemory` / `JS_HEAP_SIZE_LIMIT` | `performance.memory` triple synthesis |
| `antitamper.js` | Named `generateAntiTamper` / `te` | Dynamic XOR key/value injection position |
| `ns.js` | `fetchNs(uuid, appId)` | GET `<ns-host>/ns?c=<uuid>` sync |

⚠️ `ob.js`'s exports are a bit "wild": `module.exports = processOb` **simultaneously** attaches `.decodeOb` / `.solvePow` / `.ml` / `.buildSid` / `.getParams` on the function object. So both of the following work:

```js
const processOb = require('./ob');          // default
const { decodeOb, ml } = require('./ob');   // named — generators use this
```

---

## Minimal Demo (Decode a Capture in 10 Lines)

```javascript
const fs = require('fs');
const { decodeOb } = require('./ob');

const TAG = 'U0MmDhUmOnhXSw==';   // iFood fixed TAG (each site has its own — see ../references/validated-sites.md)
const resp = fs.readFileSync('response_1.json', 'utf8');   // a real collector response you captured

const { segments, results, state } = decodeOb(resp, TAG);
console.log('segments:', segments.length);
console.log('state.no:', state.no);
console.log('state.qa:', state.qa);
```

---

## Using These Modules

This skill's `scripts/` (and any per-site generator you build) pull the modules they need:

```javascript
const generatePayload = require('../revers/payload');   // from a sibling scripts/ dir
```

Per-site generators (the production `_px3`/`_px2` builders) live in your own project, not in this skill; each one `require`s the same modules listed above.

---

## Relationship to the Rest of the Skill

| Companion | Path |
|---|---|
| Algorithm principles + formulas | [`../references/algorithm-chain.md`](../references/algorithm-chain.md) |
| 27 OB handler shape-matching table | [`../references/handler-table.md`](../references/handler-table.md) |
| Field categories (STATIC/DYNAMIC) | [`../references/field-categories.md`](../references/field-categories.md) |
| The px-reverse skill (uses these modules) | [`../`](../) |

---

## What's NOT Here

| Not here | Where it is |
|---|---|
| Bundle path (captcha.js) PoW / WASM | **Not in this directory** — `ob.js` has a `solvePow` skeleton only; the full press path is out of scope for the passive-collector workflow. |
| CLI tools (decoders, diff, replay) | [`../scripts/`](../scripts/) |
| Real capture samples + SDK source | Your own capture project (use the `cdp-browser` skill to capture them). |

---

## How to Verify These 9 Modules Are Still Compatible With the Current SDK

```bash
# Decode round-trip against your captured batches
node ../scripts/verify_batch.js <your-samples-dir>
```

All batches passing = the 9 modules work. Any batch failing — diagnose via [`../playbooks/validate-generator.md`](../playbooks/validate-generator.md) decision tree.

---

*9 modules, multi-batch round-trip validation passed. When PX pushes a new SDK, you don't necessarily rewrite — first check whether the algorithm-layer magic constants (MD5 init / HMAC ipad / UUID v1 / INT32_MAX) are still present in the new SDK: in 3 years they have never changed.*
