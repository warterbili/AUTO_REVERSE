---
name: px-reverse
description: PerimeterX / HUMAN Security SDK reverse-engineering skill — an end-to-end workflow from packet capture to generating _px3/_px2 cookies. Includes 9 algorithm modules (payload/PC/OB/SID/UUID/anti-tamper/hash/memory/ns), CLI tool scripts, a cross-version location manual, a 27-entry OB handler shape-matching table, and 23 real-world gotchas. Validated against iFood + Grubhub (lenient) + Total Wine (strict) + Academy (strict+). Use when the user mentions PerimeterX, HUMAN Security, _pxN cookies, px-cloud.net, sensor.grubhub.com, pxcookie, or any reversing of PX collector POST traffic.
languages: [zh, en]
status: validated against ifood.com.br + grubhub.com (lenient) + totalwine.com (strict) + academy.com (strict+); all 10/10 (academy on clean residential IPs)
---

# PerimeterX SDK Reverse-Engineering Skill

> **TL;DR**: Fully reconstruct PX SDK's collector POST chain (passive mode) with pure math.
> Input: target URL + AppID. Output: a script that stably generates `_px3` / `_px2`.
>
> Every constant, field position, and field type comes from **live captures**, never from memory or stale docs.
> Validated 10/10 against iFood + Grubhub + Total Wine + Academy.

---

## When to invoke

Trigger keywords:

- `PerimeterX`, `PX`, `_px3`, `_px2`, `_pxvid`, `HUMAN Security`
- `px-cloud.net`, `sensor.grubhub.com`, `b.px-cdn.net`
- `/api/v2/collector`, `/xhr/api/v2/collector`
- "reverse PX", "PX anti-bot", "px cookie generator", "bypass PX"
- "update the SDK" (in a PX context)

**For PerimeterX only**. Akamai / Cloudflare / DataDome / Imperva → do NOT use this skill.

---

## Companion resources in the project

| Resource | Path | Purpose |
|---|---|---|
| **Validated-sites catalog** | [`references/validated-sites.md`](references/validated-sites.md) | All constants for the 4 sites + per-site b64 key map |
| **Deployment tiers** | [`references/deployment-tiers.md`](references/deployment-tiers.md) | lenient / strict / strict+ comparison + which gotchas apply |
| **CDP capture skill** | [`../cdp-browser/`](../cdp-browser/) | Real Chrome + CDP to capture collector POSTs |

---

## 🔴 Read these 7 first (in order)

Ordered by efficiency:

1. **`references/algorithm-chain.md`** — the 5 core algorithm formulas (XOR / B64 / interleave / HMAC-MD5 / OB / SID / Anti-Tamper)
2. **`references/locate-by-pattern.md`** ⭐ — the **cross-version location manual** (grep patterns + magic constants + control-flow signatures, **line-number independent**)
3. **`references/handler-table.md`** — 27 OB handlers matched by **argument shape** (universal across versions, **not dependent on wire byte names**)
4. **`references/field-categories.md`** — the STATIC/DYNAMIC/CONDITIONAL three-way classification rules
5. **`references/gotchas.md`** ⭐ — **23 real-world gotchas** (5 Bundle-path ones + the strict-tier traps #15-18 + the strict+ academy traps #19-23); each one cost real debugging time
6. **`references/deployment-tiers.md`** ⭐ — **PX lenient-tier / strict-tier / strict+ tier** comparison table, determines generator validation rigor + which gotchas apply
7. **`references/validated-sites.md`** ⭐ (NEW 2026-06-13) — a lookup table of **all constants for the 4 sites + the per-site b64 key mapping** (state/HMAC/counter), mandatory when reversing a new site (guards against the #1 portability bug)

## 🟢 Operation Manuals (Step-by-Step Playbooks)

`references/` answer "**what is this**"; `playbooks/` answer "**how to do it**":

| Playbook | When to use | Duration |
|---|---|---|
| **`playbooks/master-workflow.md`** ⭐⭐⭐ | **End-to-end overview** — full pipeline from cdp capture to 10/10 testing (Stage 0-8) | Overview |
| **`playbooks/extract-constants.md`** | New site in hand — extract constants from captures (runtime method) | 5-15 min |
| **`playbooks/locate-all-constants.md`** ⭐ | **Uniformly locate** all 5 constants from SDK source (methodology, cross-version universal) | 5-10 min |
| **`playbooks/identify-sdk-version.md`** | New SDK file in hand — determine version / whether upgraded / known vs unknown | 2-10 min |
| **`playbooks/reverse-algorithms.md`** ⭐⭐ | Reverse the 9 crypto/encoding algorithms out of an obfuscated SDK (MD5/HMAC/XOR/UUID/base91/ml/PC/anti-tamper/SID) | 1-3 h |
| **`playbooks/locate-functions.md`** ⭐⭐ | Locate the 9 categories of **functional functions** (hQ/`/ns`/OB dispatch/27 handlers/mh entry/Dd collector/cookie ur+lr/PoW/WASM) ⚠️ distinguish passive vs Bundle | 30-60 min |
| **`playbooks/locate-field-sources.md`** ⭐⭐ | Locate the **value source** of each EV field (5 methods + decision tree) | 30-60 min |
| **`playbooks/build-generator.md`** | With 6 batches of samples, write a working generator from scratch | 3-8 h |
| **`playbooks/validate-generator.md`** | Generator written — validate + failure-diagnosis decision tree (includes NEW Layer 3.5) | 10-30 min |
| **`playbooks/recover-hmac-formulas.md`** ⭐ NEW | 5-step SOP to recover HMAC/MD5 field formulas (SDK grep + 6-batch crypto verification) — every new site should follow it | 30-60 min |
| **`playbooks/reverse-strict-plus.md`** ⭐⭐ NEW | **strict+ end-to-end** (counter full pattern + /ns TLS + real template + persistent session + clean IP + 4-way matrix) — use this when every field matches but it is still rejected | 1-3 h |

### The overall flow spans two collaborating skills

```
cdp-browser/  ← Stage 0-3: launch Chrome + capture + download SDK + pin version + repeat for 6 batches
px-reverse/   ← Stage 4-8: locate constants/functions + decode + field analysis + write generator + 10/10
```

For the complete chronological chain, see [`playbooks/master-workflow.md`](playbooks/master-workflow.md).
It also includes a **failure fallback**: how to reverse by experience using only the static SDK file when cdp can't capture.

### ⚠️ Critical distinction: passive Collector vs captcha Bundle — two paths

| Path | SDK file | Trigger | Functions | Share |
|---|---|---|---|---|
| **Passive Collector** | `main.min.js` | Automatic | hQ + `/ns` + OB + mh + Dd + cookie ur/lr | **99%** |
| **Captcha Bundle** | **`captcha.js`** | High risk score | + PoW solver + WASM loader + captcha interaction | <1% |

For 99% of scenarios, writing the passive generator is enough — **do NOT touch `captcha.js` / PoW / WASM at all**.
See the path-distinction section at the top of [`playbooks/locate-functions.md`](playbooks/locate-functions.md).

---

## 🛠️ Tools bundled in the skill (all Node.js, no external dependencies)

### `revers/` — 9 algorithm modules (bundled, directly `require('../revers/...')`-able from scripts/)

| Module | Default export | Purpose |
|---|---|---|
| `payload.js` | `generatePayload` + `.decodePayload` | Algorithm chain: serialize → XOR(50) → b64 (UTF-8) → interleave |
| `pc.js` | `generatePC` + `.hmacMD5` | HMAC-MD5 + digit extraction → 16-digit PC |
| `ob.js` | `decodeOb`, `ml`, ... | OB segment decoding + handler shape recognition |
| `sid.js` | `generateSid` | Plane 14 Tag Char Unicode steganography |
| `uuid.js` | `getUUID`, `uuidV1`, ... | RFC 4122 v1 (with PX-compatible clockseq) |
| `hash.js` | `generateHash`, `Kt` | djb2 hash variant |
| `memory.js` | `generateMemory` | `performance.memory` synthesis |
| `antitamper.js` | `generateAntiTamper`, `te` | XOR-based anti-tamper key/value injection |
| `ns.js` | `fetchNs` | GET `/ns` endpoint sync |

For full algorithm descriptions, see [`references/algorithm-chain.md`](references/algorithm-chain.md).

### `scripts/` — 18 CLI tools (categorized by function)

#### Decoders (3 — turn captured byte streams into JSON)

| Script | Purpose | Input | Output |
|---|---|---|---|
| `decode_payload.js` | Decode EV1/EV2 from a curl file | `request_*.txt` | EV JSON |
| `decode_response.js` | Decode OB segments from collector response | `response_*.txt` + TAG | state + segments |
| `extract_hQ.js` | Extract the 1152-entry hQ dictionary from main.min.js | `main.js` | `hQ_map.json` |

#### Cross-batch analysis (4 — compare multiple capture batches against each other)

| Script | Purpose | Input | Output |
|---|---|---|---|
| `diff_samples.js` | Three-way classification of EV fields across N batches | Multiple EV JSON | `field_classes.json` |
| `diff_samples.py` | Python version of the above | Same | Same |
| **`build_templates.js`** | ⭐ Auto-build STATIC field templates from 6 batches | N batches of decoded_payload | `templates/<site>_ev*_template.json` + field_map |
| **`identify_dynamic_semantics.py`** | Auto-classify DYNAMIC field semantics (timestamp/UUID/HMAC/…) | DYNAMIC keys + multi-batch values | `semantic.json` |

#### state.* cross-sample value matching (1 — ⭐ the most critical step in methodology Stage 5)

| Script | Purpose | Input | Output |
|---|---|---|---|
| **`find_state_keys_in_ev2.py`** | ⭐⭐⭐ Find the EV2 b64 keys for state.no/to/qa/vid/pxsid/appId | 6 batches of state + 6 batches of EV2 | `state_key_map.json` |

#### Field location (2 — b64 key ↔ SDK source location)

| Script | Purpose | Input | Output |
|---|---|---|---|
| `lookup_keys.js` | Reverse-lookup base64 key → SDK location via hQ_map | b64 key + hQ_map + SDK | `via/idx` info |
| `probe_dynamic.js` | Locate the SDK assignment point of DYNAMIC fields | DYNAMIC keys + multi-batch values | `semantic.json` |

#### Ours-generated vs real-captured comparison (9 — used for debugging while writing the generator)

| Script | Purpose | Input | Output |
|---|---|---|---|
| **`diff_http_request.py`** | ⭐ **My POST vs browser POST** byte-level diff (headers + form params + order) | 1 browser-captured request + my generator | console diff table |
| **`compare_ev2_field_by_field.py`** | Field-by-field equality check of my generated EV2 vs real-captured EV2 | my ev2.json + real ev2.json | field-level diff report |
| **`diff_ev_ours_vs_real.py`** ⭐ | (NEW 2026-05-25) 5-section diagnosis: field set / type / STATIC value / order / counter sync — the mainstay for strict-tier deployment debugging ([deployment-tiers.md](references/deployment-tiers.md)) | my ev dump + 6 batches of real ev | console report + json summary |
| **`cross_event_consistency.py`** ⭐⭐⭐ | (NEW 2026-06-12) **cross-event consistency** — the dimension all the diffs above (single-snapshot) cannot see: CONSTANT (page-load ts/uuid/platform constant across EVs) + MONOTONIC (perf/counter/now-ts increasing across EVs). **The hidden root cause of low trust on strict tiers** ([gotchas.md Bug #19](references/gotchas.md)). Run it on real packets first to extract rules, then on the generator dump and compare line by line | `samples/` with N/decoded_payload_{1,2,3}.json | console rule table (flagged "MUST preserve") |
| **`find_hmac_field_sources.py`** ⭐ | (NEW 2026-05-25) Step 2+3 of [`recover-hmac-formulas.md`](playbooks/recover-hmac-formulas.md) — grep the SDK to find HMAC field assignment points + helper function bodies | SDK path + target b64 keys | console outputs fn bodies, feed to Step 4 |
| **`replay_apples_to_apples.py`** ⭐ | (NEW 2026-05-25) Layer 3.5 validation tool — under the same proxy and same TLS, compares browser cookie vs ours vs empty cookie three ways, distinguishing "cookie content flagged as bot" from "transport problem" | HTTPS_PROXY env + TARGET_URL env | console outputs 4-way matrix |
| **`session_server.py`** ⭐⭐ | (NEW 2026-06-13 strict+) site-agnostic **persistent Chrome-TLS sidecar**: the whole chain /ns+collector+edge rides one curl_cffi chrome142 session (Bug #21/#22/#23); the generator forwards its /ns and every POST to :8765 | `PX_IMPERSONATE`/`PX_PROXY`/`PX_UA` env | a resident HTTP service |
| **`trust_matrix.py`** ⭐⭐ | (NEW 2026-06-13 strict+) site-agnostic **4-way trust matrix**: real browser/curl × real/our cookie, localizing "the wall is in cookie content vs transport/IP" (replaces replay, fully automated CDP+curl) | `HOME_URL`/`GATED`/`COOKIE`/`OUR_COOKIE` env | 4-cell verdict + read-out |
| **`diff_ev_field_by_field.py`** ⭐⭐ | (NEW 2026-06-13) site-agnostic field-by-field diff: STATIC MISMATCH / TYPE MISMATCH / SHAPE DIFF three classes of problem field ([reverse-strict-plus.md](playbooks/reverse-strict-plus.md) Step 2) | `mine.json real.json [override_keys.txt]` | problem-field count + exit code |

#### Cross-version migration (1)

| Script | Purpose | Input | Output |
|---|---|---|---|
| `map_keys.js` | Old SDK key → new SDK key value-matching migration | old px_cookie + new EV sample | migration map |

#### End-to-end validation (1 — ⭐ regression test)

| Script | Purpose | Input | Output |
|---|---|---|---|
| **`verify_batch.js`** | ⭐⭐ Run the decode round-trip over a batch of samples, asserting decode output = decoded_*.json | `samples/<site>/<N>/` whole batch | pass / where it failed |

---

### Cross-tool relationship matrix (which tool does which job)

```
                     1 real capture       N real captures      ours-generated 1
                     ───────              ───────              ─────────
1 real capture       —                    diff_samples.*       diff_http_request.py
                                          compare_ev2_*        compare_ev2_field_*
                                          find_state_keys_*
N real captures      —                    build_templates.js   (—)
                                          identify_dynamic_*
ours-generated 1     diff_http_request    (—)                  —
                     compare_ev2_*

Standalone:
  decode_payload     curl/txt → EV JSON
  decode_response    response → state + ob segments
  extract_hQ         SDK → hQ_map.json
  lookup_keys        b64 key → SDK location
  probe_dynamic      DYNAMIC keys → SDK assignment context
  map_keys           old SDK → new SDK key migration
  verify_batch       round-trip prover (decode round-trip)
```

---

## 📋 Standard workflow (reversing a new PX site from scratch)

```
Stage 1 [15-30 min] —— capture 6+ batches of fresh samples
  Use the companion CDP capture skill's capture_via_cdp_ifood.py (or adapt a new-platform version)
  Each batch outputs: samples/N/{request_1.txt, response_1.json, request_2.txt,
                        response_2.json, meta.json}
  meta.json must contain sdk_sha256 —— to prove all 6 batches share the same SDK
  Also save the SDK to sdk/<site>/main.min.js (or init.js)

Stage 2 [10 min] —— run the round-trip with verify_batch (if implemented)
  Have every batch produce decoded_payload_{1,2}.json + decoded_response_{1,2}.json
  Stop immediately on failure → decoder's constants for this site are wrong

Stage 3 [10 min] —— three-way field classification
  node scripts/diff_samples.js samples/{1..6} > field_classes.json
  Focus on the DYNAMIC set (usually 15-30 fields) —— these are the ones the algorithm must generate

Stage 4 [1-3 h] —— ⭐ field semantics identification (most prone to gotchas)
  state.* injection fields are the most dangerous —— they need parseInt, not to stay strings
  For each state.{no,to,appId,o111val,qa,vid,pxsid,cts}:
    find the matching base64 key in each EV2 batch; a consistent hit across all 6 batches = confirmed
  The rest of DYNAMIC (HMAC, timestamps, memory, Date.toString, performance.now,
    /ns sm+duration, error stack, network connection) are generally results of SDK function calls

Stage 5 [1-2 h] —— write generator.js
  1) Constants: APP_ID, TAG, FT, COLLECTOR_URL, BI
  2) Template paths: templates/<site>_ev{1,2}_template.json
  3) DYNAMIC key names in buildEv1/buildEv2
  4) extractState needs no change (matches by shape, already universal)
  Key: when debugging with the PX_TAG env var, always pass the correct value

Stage 6 [10 min] —— 10/10 stability test
  One every 10-15 seconds to avoid IP throttle
  Expected: all status=200 + different _pxN values
  On failure, troubleshoot in the order of references/gotchas.md
```

---

## ⚡ The template method (**the core methodology**)

**Most EV1/EV2 fields are invariant**: iFood EV2 has 209 fields total — 169 STATIC (81%),
20 DYNAMIC (10%), 14 PARTIAL/CONDITIONAL (including the anti-tamper slot), 6 CONDITIONAL.

**Meaning**: hand-writing 200 fields and getting one wrong = 403. **Use a real capture as the template
and only override the DYNAMIC fields**:

```javascript
const template = JSON.parse(fs.readFileSync('templates/ifood_ev2_template.json'));
const ev2 = JSON.parse(JSON.stringify(template));   // deep clone

// Override only the ~17 DYNAMIC fields (leave the other 192 untouched)
ev2[0].d['RTEwewNQMUg='] = parseInt(state.no);    // ⭐ parseInt!
ev2[0].d['M2MGKXUOBB8='] = hmacMD5(uuid, UA);
ev2[0].d['Xi5rJBtKaB4='] = state.appId;
// …
```

**10x faster than the SDK-disassembly + field-rewrite method, with a 10x lower error rate**.

> ⚠️ **The template method is necessary but not sufficient — on strict / strict+ sites, just applying a template stalls at low trust (the biggest conceptual trap).**
> The template handles STATIC fields, but the strict-tier backend validates the **semantics of the DYNAMIC fields + cross-event consistency + counter legal pattern + mint transport authenticity**, none of which a template reveals. Strict / strict+ sites **must** additionally do:
> 1. **Field-by-field diff** (my EV vs real capture): static must be equal, dynamic must match shape + **legal value pattern** (not just "has a value").
> 2. **Cross-event consistency** (`cross_event_consistency.py`): CONSTANT constant across EVs, MONOTONIC increasing across EVs.
> 3. **Reverse the live fields to their real source in the SDK** (grep the b64-key literal `t["<key>"]=<expr>`); don't guess the value's shape.
> 4. **The trust 4-way matrix** (real browser/curl × real/our cookie) localizes "the wall is in cookie content or transport/IP."
> 5. **strict+ (academy-class)**: the template **should be captured from real Chrome CDP** (a JSDOM static template is the less-preferred default, though node_bridge running the live SDK is not a trust ceiling), /ns over real Chrome TLS, one fresh residential IP per cookie. See Bug #19-#23 + [`deployment-tiers.md`](references/deployment-tiers.md) tier 3.
>
> In one sentence: **the template method ensures "no missing fields," deep reversing ensures "dynamic fields correct, cross-event consistent, transport authentic enough." You need both.**

---

## ⚠️ Top 5 Gotchas (must remember — all 23 are in `references/gotchas.md`)

### Gotcha #1 — `state.no` must be a number ⭐⭐⭐

The `state.no` decoded from OB is the string `"1779263519570"`; **it must be parseInt'd when injected into EV2**:

```js
ev2.d['RTEwewNQMUg='] = parseInt(state.no);   // ✅ iFood
ev2.d['UT0ndxdcJUQ='] = parseInt(state.no);   // ✅ Grubhub (different key!)
```

**Symptom**: collector#2 returns `{"do":null}` (PC passes) but OB has only 2 segments, never any _px3.

### Gotcha #2 — base64 must be UTF-8 ⭐⭐

```js
Buffer.from(t, 'utf-8').toString('base64')   // ✅
// Encoding with Latin-1 breaks it immediately
```

### Gotcha #3 — anti-tamper must keep the template's **original position** ⭐⭐⭐

```js
// ❌ Wrong (key moves to the end, changing iteration order)
delete d[oldKey]; d[newKey] = newVal;

// ✅ Right (rebuild the dictionary to preserve position)
const out = {};
for (const k of Object.keys(d)) {
    out[ANTI_TAMPER_RE.test(k) ? newKey : k] = (
        ANTI_TAMPER_RE.test(k) ? newVal : d[k]
    );
}
```

### Gotcha #4 — OB decoding uses binary, not utf-8 ⭐⭐

```js
Buffer.from(ob, 'base64').toString('binary')   // ✅
// utf-8 corrupts bytes ≥0x80
```

### Gotcha #5 — when decoding the POST body, do **NOT** replace base64's `+` with a space ⭐⭐⭐

```js
// ❌ Wrong (base64's + gets eaten into a space)
const v = decodeURIComponent(raw.replace(/\+/g, '%20'));

// ✅ Right
const v = decodeURIComponent(raw);
```

For all 23 (5 Bundle-path ones + strict #15-18 + strict+ academy #19-23), see [`references/gotchas.md`](references/gotchas.md).

---

## 🎯 The four validated sites (reference) — spanning 3 tiers

| Site | Tier | AppID | TAG | FT | Cookie | Measured |
|---|---|---|---|---|---|---|
| ifood.com.br | lenient | `PXO1GDTa7Q` | `U0MmDhUmOnhXSw==` | `401` | `_px3` (ttl 330) | **10/10** |
| grubhub.com | lenient | `PXO97ybH4J` | `FmYgK1gdJEAP` | `359` | `_px2` (ttl 500) | **10/10** |
| totalwine.com | strict | `PXFF0j69T5` | `CFQ7WU4xIS8MXA==` | `401` | `_px2` (ttl 330) | **10/10** |
| **academy.com** | **strict+** | `PXqqxM841a` | `dgYGCzBjH3pyBg==` | `405` | `_px3` (ttl 330) | **10/10** (clean residential IPs) |

⚠️ Old docs wrote the Grubhub AppID as `PXdRotaCw0` / the FT as `330` —— **both wrong**.
The values listed in this skill are extracted directly from real-captured POST bodies.

📖 **All constants for the 4 sites + the per-site b64 key mapping (state/HMAC/counter) + wire chars + cold/warm strategy**
→ [`references/validated-sites.md`](references/validated-sites.md) (the lookup table for reversing a new site).

> academy is **strict+** (the third tier): on top of the totalwine strict tier, trust is also bound to the mint's **transport TLS +
> the /ns TLS fingerprint + the template having to be real Chrome + the exit IP reputation** (gotchas Bug #20-#23).
> It is also the first site where the **field-by-field diff fully passes yet trust is still low** — the real cause was a single **illegal counter pattern** (Bug #20).

---

## ✅ Validation criteria

| Stage | Pass criterion |
|---|---|
| Decode round-trip | Self-generated payload, after decoding, = real capture decoded |
| collector#1 | status=200, OB contains `state.no` + `state.appId` + `state.to` |
| collector#2 | status=200, OB contains a set_cookie segment (4+ args, starts with `_px*`) |
| End-to-end | Run ≥ 5 times, all yielding different `_pxN` strings |
| Business API | Request the business API with the obtained cookie → 200 OK |

---

## ❌ "Natural-language traps" you must not fall into

1. **"Close enough"** — the algorithm layer is precision-sensitive; one byte off = 403
2. **"It should be XXX"** — must be verified against SDK source or sample comparison, never guessed
3. **"Just use JSON.stringify"** — wrong, must use PX's custom serialize
4. **"Try some randomness"** — wrong, DYNAMIC fields also have reasonable ranges; use real statistical values
5. **"Add some sleep and see"** — timing isn't the problem, the crypto is
6. **"That's just what the doc says"** — old docs can be wrong (already caught the Grubhub AppID error).
   **Look directly at the capture**

---

## Doc navigation

The skill layout in this plugin:

```
skills/web/
├── px-reverse/    ← this skill (what you're reading): references/ + playbooks/ + scripts/ + revers/
└── cdp-browser/   ← companion CDP capture tools
```

If the user asks:

- "how to reverse a new PX site from scratch" → follow §Standard workflow above
- "how to find EV2 fields" → `references/handler-table.md` + `field-categories.md`
- "the new SDK's line numbers are all different" → `references/locate-by-pattern.md`
- "my generator can't get _px3" → troubleshoot `references/gotchas.md` in order
- "PX vs Akamai / Cloudflare" → out of scope for this skill

---

*This skill was validated 2026-06-13 against iFood + Grubhub (lenient) + Total Wine (strict) + Academy (strict+); all 10/10.*
