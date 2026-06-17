# Playbook: From 6 Capture Batches to a Working px_cookie Generator

> You already have the 5 constants (APP_ID/TAG/FT/BI/Cookie) plus 6 fresh capture batches.
> This playbook breaks the full "from capture to a generator that produces cookies" flow into 8 concrete steps.
>
> Estimated time: **3-8 hours** (including debugging)

---

## Prerequisite checklist

Before running this playbook, confirm:

```bash
# ✅ 1. Project has 6 capture batches
ls samples/{1..6}/request_1.txt | wc -l   # should be 6

# ✅ 2. SDK SHA is identical across all 6 batches
for i in 1 2 3 4 5 6; do
    jq -r '.sdk_sha256' samples/$i/meta.json
done | sort -u   # should print exactly 1 line

# ✅ 3. SDK file is in place
ls source/main.min.js

# ✅ 4. The 5 constants are known
echo "APP_ID=$APP_ID TAG=$TAG FT=$FT BI=${BI:0:20}... Cookie=$COOKIE"
```

If any of these is missing, go to [`extract-constants.md`](extract-constants.md) first, or capture them yourself.

---

## Stage 1: Decode all 6 sample batches (10 min)

Run the decoder on each batch, producing `decoded_payload_{1,2}.json` + `decoded_response_{1,2}.json`:

```bash
cd samples
for i in 1 2 3 4 5 6; do
    node ../scripts/decode_payload.js  $i/request_1.txt \
        > $i/decoded_payload_1.json
    node ../scripts/decode_payload.js  $i/request_2.txt \
        > $i/decoded_payload_2.json
    node ../scripts/decode_response.js "$TAG" $i/response_1.json \
        > $i/decoded_response_1.json
    node ../scripts/decode_response.js "$TAG" $i/response_2.json \
        > $i/decoded_response_2.json
done
```

The iFood project already ships a ready-made wrapper:

```bash
cd <reference-site>/script
./decode_all.sh
```

### Validation: every batch must decode to valid JSON

```bash
for i in 1 2 3 4 5 6; do
    n=$(jq '.[0].d | keys | length' samples/$i/decoded_payload_2.json 2>/dev/null)
    echo "batch $i EV2 field count: $n"
done
# Expected: ~200 fields per batch
# null or 0 → decode failed → wrong TAG or bad base64 handling (see gotchas.md #5)
```

---

## Stage 2: Three-way field classification (10 min)

Run a cross-batch diff over the 6 EV2 batches, splitting fields into STATIC (identical every time) / DYNAMIC (changes every time) / CONDITIONAL (present in some batches only):

```bash
node ../scripts/diff_samples.js \
    samples/{1..6}/decoded_payload_2.json \
    --out field_classes_ev2.json
```

**Typical output** (iFood):

```
STATIC      : 169 fields   (81%) ← copy straight from the template
DYNAMIC     :  20 fields   (10%) ← must be algorithmically generated
CONDITIONAL :  14 fields   ( 7%) ← only on warm visits, absent on cold
other       :   1 field    ( 1%) ← anti-tamper slot
total       : 204 fields
```

⭐ **Focus on those 20 DYNAMIC fields** — these are all the "must be algorithmically generated" fields you'll spend the rest of your time solving.

---

## Stage 3: Build the STATIC template (5 min)

Use batch 1 as the STATIC template (cold visit, cleanest):

```bash
# Take batch 1's EV1 + EV2 as the template
cp samples/1/decoded_payload_1.json templates/ev1_template.json
cp samples/1/decoded_payload_2.json templates/ev2_template.json
```

Or use the dedicated build_templates.js (carries field-classification metadata):

```bash
node ../scripts/build_templates.js \
    samples/{1..6}/decoded_payload_{1,2}.json \
    --out templates/
```

---

## Stage 4: ⭐⭐⭐ Locate the injection positions for state.\* (30-60 min)

**This is the most critical and most error-prone step.**

state.\* is decoded out of the OB#1 response (e.g. `state.no`, `state.to`, `state.appId`),
but these values must be "injected" into specific b64 key positions in EV2 — **this mapping cannot be derived by any algorithm; it must be value-matched.**

```bash
python ../scripts/find_state_keys_in_ev2.py \
    --samples samples \
    --batches 1 2 3 4 5 6 \
    > templates/state_key_map.json
```

**Example output** (iFood):

```json
{
    "state.no":      "RTEwewNQMUg=",   ← matched consistently across all 6 batches
    "state.to":      "FCAhKlJCIxk=",
    "state.appId":   "Xi5rJBtKaB4=",
    "state.qa":      "WjFqHE4WKzM=",
    "state.vid":     "PRkqQAphHTM=",
    "state.pxsid":   "XSkoMTBYbAM=",
    "state.cts":     "MykPYjwoaC8=",
    "state.o111val": "Y0BIcEM0NSI="
}
```

If any state.X fails to resolve → see [`../references/gotchas.md`](../references/gotchas.md) #1
(state.no must be parseInt-ed before value matching) + #11 (b64 keys differ across platforms).

---

## Stage 5: Identify the semantics of the other DYNAMIC fields (30-60 min)

Of the 20 DYNAMIC fields, besides state.\* (9 of them), the remaining ~11 carry other semantics (HMAC, timestamps, UUID, memory, etc.).

```bash
python ../scripts/identify_dynamic_semantics.py \
    field_classes_ev2.json \
    --samples samples \
    > templates/dynamic_semantic_map.json
```

**Example output**:

```json
{
    "VQEgCxNnKjw=": { "role": "initTime",        "algorithm": "Date.now()" },
    "bHgZcikfE0A=": { "role": "sendTime",        "algorithm": "initTime + 1-2s" },
    "NSEAa3NAC18=": { "role": "uuid_v1",         "algorithm": "uuidV1()" },
    "Czt+cU1WeEM=": { "role": "Date.toString()", "algorithm": "new Date().toString()" },
    "M2MGKXUOBB8=": { "role": "HMAC(uuid, UA)",   "algorithm": "hmacMD5(uuid, UA)" },
    "NABBSnJgQXE=": { "role": "memory.used",     "algorithm": "random(40_000_000, 140_000_000)" },
    ...
}
```

Fields that can't be identified automatically (a few) require reading the SDK source manually:

```bash
node ../scripts/probe_dynamic.js \
    field_classes_ev2.json \
    hQ_map.json \
    source/main.min.js
```

This outputs where in the SDK each unidentified field is assigned, so you can infer its semantics from context.

---

## Stage 6: Write generator.js (1-3 hours)

Start from an existing one (**strongly recommended — just change the constants**):

```bash
# Copy an existing iFood generator as your starting point
cp ifood_px3.js <site>_pxN.js   # copy a reference generator as your starting point
```

Change 4 things in the new file:

```js
// 1. Constants
const APP_ID = '<new AppID>';
const TAG    = '<new TAG>';
const FT     = '<new FT>';
const COLLECTOR_URL = 'https://collector-<lowercase AppID>.px-cloud.net/api/v2/collector';

// 2. Template paths
const EV1_TEMPLATE = require('./templates/ev1_template.json')[0];
const EV2_TEMPLATE = require('./templates/ev2_template.json')[0];

// 3. state.* → EV2 b64 key mapping (use the Stage 4 output)
const STATE_KEY_MAP = require('./templates/state_key_map.json');

// 4. Override the DYNAMIC fields inside buildEv2() (use the Stage 5 output)
function buildEv2(ctx) {
    const e = JSON.parse(JSON.stringify(EV2_TEMPLATE));   // deep clone STATIC
    const d = e.d;

    // Use the Stage 4 state.* mapping
    d[STATE_KEY_MAP['state.no']]    = parseInt(ctx.state.no);   // ⭐ must parseInt
    d[STATE_KEY_MAP['state.to']]    = ctx.state.to;
    d[STATE_KEY_MAP['state.appId']] = ctx.state.appId;

    // Use the Stage 5 DYNAMIC mapping
    d['<key for initTime>']   = ctx.initTime;
    d['<key for sendTime>']   = ctx.sendTime;
    d['<key for uuid>']       = ctx.uuid;
    d['<key for HMAC(uuid)>'] = hmacMD5(ctx.uuid, ctx.UA);
    // ... and so on

    // anti-tamper (must replace key + value **in place**)
    return injectAntiTamper(e, ctx.state);
}
```

**Key reminders** (must-read, each one cost debug time):

```js
// ❌ Wrong (always 403)
d['RTEwewNQMUg='] = ctx.state.no;   // string

// ✅ Right
d['RTEwewNQMUg='] = parseInt(ctx.state.no);   // number
```

⭐ Read [`../references/gotchas.md`](../references/gotchas.md) — must-read #1 + #3 + #4 + #5.

---

## Stage 7: Local smoke test (5 min)

Run the generator without hitting real HTTP:

```bash
cd px_cookie
node smoke_test.js  # if you wrote a smoke script; see ifood/px_cookie/smoke_test.js
```

Or a minimal require test:

```bash
node -e "
const gen = require('./<site>_pxN.js');
console.log('loaded:', typeof gen);
// don't actually run it, just make sure require doesn't crash
"
```

A `require` error → wrong template path / wrong reverse module path.

---

## Stage 8: ⭐ Live 10/10 validation (10-30 min)

```bash
node <site>_pxN.js
```

Expected output:

```json
{
  "cookie_name": "_px3",
  "cookie_value": "eyJ1IjoiYWJjLi4uIn0=",
  "ttl": 330,
  "uuid": "...",
  "state": { "no": "...", ... },
  "ev1_fields": 14,
  "ev2_fields": 204
}
```

Run 10 times (≥ 10 s apart to avoid IP throttling):

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
    echo "── run $i ──"
    timeout 30s node <site>_pxN.js | jq -r '.cookie_name + "=" + .cookie_value[0:30] + "..."'
    sleep 12
done
```

**Pass criteria**: all 10/10 output the `_pxN=eyJ...` form.

---

## Failure diagnosis quick reference

By "symptom → likely cause → fix":

| Symptom | Where to look |
|---|---|
| `collector#1 HTTP 403` | TLS fingerprint → confirm you're using real Chrome via CDP, not a raw script POST |
| `collector#2 HTTP 200, do:null, no _px3` | Stage 4 state.no type error ([gotchas #1](../references/gotchas.md)) |
| `collector#2 HTTP 200, has _px3 but business API still 403` | EV2 has too many/too few fields ([gotchas #11](../references/gotchas.md)) |
| `decode output is all garbage` | Wrong TAG or base64 encoding ([gotchas #2 #4](../references/gotchas.md)) |
| `some batches succeed, some fail` | IP throttling, space requests ≥ 10s apart ([gotchas #13](../references/gotchas.md)) |
| `works once, fails the next time` | UA mismatched between the HMAC and the HTTP header ([gotchas #10](../references/gotchas.md)) |

See the full 19 gotchas in [`../references/gotchas.md`](../references/gotchas.md).

---

## Progress tracking table

| Stage | Duration | Output | Difficulty |
|---|---|---|---|
| 1. Decode 6 batches | 10 min | 24 decoded_*.json | base64 + escaping |
| 2. Three-way classification | 10 min | field_classes_ev2.json | none |
| 3. Templates | 5 min | ev1/ev2_template.json | none |
| 4. state.* | 30-60 min | state_key_map.json | ⭐ no algorithm to derive it |
| 5. DYNAMIC semantics | 30-60 min | dynamic_semantic_map.json | some require manual work |
| 6. Write generator | 1-3 h | generator.js | 19 gotchas |
| 7. smoke test | 5 min | (pass) | paths |
| 8. 10/10 live | 10-30 min | (pass) | IP throttling |
| **Total** | **3-8 hours** | | |

---

## Companion resources

| What you want | Where to go |
|---|---|
| The 5 core algorithm formulas | [`../references/algorithm-chain.md`](../references/algorithm-chain.md) |
| EV2 field semantics reference | [field-categories.md](../references/field-categories.md) |
| Ready-made iFood generator (best starting point) | your per-site generator (e.g. `ifood_px3.js`) |
| The 9 reverse algorithm modules | [`../revers/`](../revers/) |
| Validation / troubleshooting | [`validate-generator.md`](validate-generator.md) |

---

*When you successfully produce your first `_pxN=...`, feed the `cookie_value` to the business API.
A 200 response → the whole pipeline is done. We recommend running a 10-run stability test before declaring it "done".*
