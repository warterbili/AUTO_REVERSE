# Playbook: Generator Validation + Failure Diagnosis

> Your generator is written, and you need to confirm it **actually works** + how to
> diagnose problems.
>
> Estimated time: **10-30 minutes** (everything smooth) / 0.5-3 hours (debug).

---

## Four Validation Layers (2026-05-25 update: added Layer 3.5)

```
┌────────────────────────────────────────────┐
│  Layer 1:   load + static check (no HTTP)    │  5 sec
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│  Layer 2:   decode closed-loop (no network)  │  30 sec
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│  Layer 3:   10/10 collector accepts payload  │  2-3 min
│             ⚠️ passing Layer 3 ≠ generator   │
│                truly usable                  │
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│  Layer 3.5: 10/10 real hits on PX-gated      │  3-5 min
│             endpoint (NEW). Use cookie to GET │
│             an endpoint that 403s on empty    │
│             cookie → get a real 200 +         │
│             real HTML/JSON                    │
└────────────────────────────────────────────┘
```

Every layer's failure has its own diagnosis path. Pass Layer 1, then Layer 2, then Layer 3,
**then Layer 3.5**.

⚠️ **Important change (2026-05-25)**: historically the skill assumed passing Layer 3 meant
the generator was OK. The totalwine case proved this is wrong under strict-tier deployments
([deployment-tiers.md](../references/deployment-tiers.md), [gotchas.md #15](../references/gotchas.md)) —
you must add Layer 3.5 to count as a true pass. iFood/Grub's `business_api_demo.js` has
actually been doing this step all along; it just wasn't listed as a formal separate Layer.

---

## Layer 1: Load + Static Check (5 sec)

**Goal**: ensure the generator can `require()`, the template loads, and constants aren't
misspelled.

```bash
node -e "
const gen = require('./<site>_pxN.js');
console.log('  ✓ require succeeded');
console.log('  exports type:', typeof gen);
console.log('  async function?:', gen.constructor.name === 'AsyncFunction');
"
```

**Expected output**:

```
  ✓ require succeeded
  exports type: function
  async function?: true
```

A more complete smoke test (recommended to write one):

```bash
node smoke_test.js
# 13/13 ✓ passing is enough (see ifood/px_cookie/smoke_test.js)
```

### Layer 1 Failure Diagnosis

| Error | Cause | Fix |
|---|---|---|
| `Cannot find module '../reverse/payload'` | wrong reverse path | change to `../../../revers/payload` |
| `Cannot find module './templates/...'` | wrong template path | fix path.join or copy the template to the same directory |
| `SyntaxError` | JS syntax error | fix at the error line number |
| `templates/ev2_template.json: Unexpected token` | template JSON is broken | re-capture 6 batches of samples |

---

## Layer 2: Decode Closed-Loop Validation (30 sec)

**Goal**: use the existing 6 batches of samples to verify the decoder works under the
current SDK. This step **does not hit PX** — purely local.

```bash
bash verify_all.sh
```

Or the generic version:

```bash
for i in 1 2 3 4 5 6; do
    node ../scripts/verify_batch.js samples/$i
done
```

**Expected output**:

```
[1/6] samples/1
  payload_1 decode:   PASS
  payload_1 round:    PASS
  pc_1:               PASS
  payload_2 decode:   PASS
  payload_2 round:    PASS
  pc_2:               PASS
  state mapping:      PASS
[OVERALL] 6/6 PASS
```

### Layer 2 Failure Diagnosis

By failing stage:

| Failing stage | Meaning | Which gotcha to read |
|---|---|---|
| `payload decode FAIL` | base64 / XOR error | [#2 base64 UTF-8](../references/gotchas.md), [#5 + char](../references/gotchas.md) |
| `payload round FAIL` | my re-encode doesn't match the original payload | [#10 interleave even length](../references/gotchas.md) |
| `pc FAIL` | the HMAC-MD5-computed PC doesn't equal the original PC | wrong TAG? UA out of sync with HTTP? |
| `state mapping FAIL` | state.* → EV2 b64 key wrong | [#11 keys differ across platforms](../references/gotchas.md) |
| `anti-tamper FAIL` | slot / algorithm wrong | [#3 replace in place](../references/gotchas.md) |

⚠️ A Layer 2 failure means **the generator wasn't built on a correct decoder** — don't rush
into Layer 3; fix the decoder first.

---

## Layer 3: 10/10 Live Validation (2-3 min)

**Goal**: actually hit the PX collector, see whether you can get a cookie, 10 stable passes.

```bash
PASS=0
FAIL=0
for i in 1 2 3 4 5 6 7 8 9 10; do
    echo "─── run $i ───"
    output=$(timeout 30s node <site>_pxN.js 2>&1)
    if echo "$output" | grep -q '"cookie_name":"_px[23]"'; then
        cookie=$(echo "$output" | jq -r '.cookie_value' | cut -c1-30)
        echo "  ✓ got cookie: $cookie..."
        PASS=$((PASS+1))
    else
        err=$(echo "$output" | head -c 200)
        echo "  ❌ failed: $err"
        FAIL=$((FAIL+1))
    fi
    sleep 12   # must be ≥ 10s, otherwise IP throttle
done
echo ""
echo "═══════════════════════════════"
echo "  10/10 test: $PASS passed, $FAIL failed"
echo "═══════════════════════════════"
```

**Pass criteria**: 10/10. On any failure, immediately consult the diagnosis below.

### Layer 3 Failure Diagnosis Decision Tree

```
Got a cookie_value?
├─ ❌ check the error message
│
│   ├─ "collector#1 HTTP 403/4xx"
│   │   → TLS fingerprint problem. **Use real Chrome + CDP, don't send directly from a script**
│   │   → or check headers (Origin, Referer)
│   │
│   ├─ "collector#1 HTTP 200 but ob is empty"
│   │   → PC computed wrong. Check:
│   │     - is TAG correct (grep the tag= in the real captured POST)
│   │     - are UA and the HTTP header the same variable
│   │     - did you use unquote_plus and turn + into a space (gotchas #5)
│   │
│   ├─ "after decoding ob#1, no state.no / state.to / state.qa"
│   │   → OB XOR key wrong. Verify ml(TAG) % 128 is the correct value
│   │   → or OB uses binary not utf-8 decode (gotchas #7)
│   │
│   ├─ "collector#2 HTTP 200 but do:null, ob only 2 segments, no set_cookie"
│   │   → ⭐⭐⭐ state.no not parseInt'd (gotchas #1)
│   │   → or EV2 field order wrong (gotchas #3 anti-tamper)
│   │   → or EV2 has extra/missing fields (see compare_my_ev2.py)
│   │
│   ├─ "collector#2 HTTP 200 with set_cookie, but the business API still 403s"
│   │   → cookie written wrong? Check the final _pxN string
│   │   → or you triggered the Bundle path? See the Bundle section
│   │
│   └─ "partial batch success (e.g. 5/10)"
│       → ⭐ IP throttle (most common). Increase the interval to ≥ 15s
│       → or a UA consistency problem
│
└─ ✅ all 10 got _pxN
    → the generator works! Next, use the cookie against the real business API
```

---

## ⭐ MANDATORY Pre-Layer-3.5 step: Run `diff_ev_ours_vs_real.py` (2026-05-25 closed-loop)

> Claiming Layer 3 is complete without running this step is forbidden. This step is the
> **automated minesweeper** for the 5 classes of strict-tier traps: Gotcha #12 (extra
> fields), #1/#10 (type errors), #3 (STATIC values / AT slots), #17 (counter sync).

```bash
# 1. Have the generator dump EV1/EV2/EV3 to JSON
DUMP_EV_DIR=samples/_our_ev node <site>_pxN.js

# 2. Run the diagnosis (skill generic version, or the per-site version in your project's `script/`)
python ../scripts/diff_ev_ours_vs_real.py
```

**Pass criteria**: all 6 segments ✅. **Any 🔴 segment forbids entering Layer 3.5.**

| Segment | Check | Red violation maps to gotcha |
|---|---|---|
| 1 | field-set difference (only-ours / only-real) | #12 extra fields / missing key |
| 2 | type inconsistency (string vs number etc.) | #1 state.no not parseInt'd / #10 field type table |
| 3 | STATIC field value deviation | template bake polluting batch / copied a wrong value |
| 4 | field order (generally ignorable — PX randomizes it itself) | #3 anti-tamper position drift |
| 5 | anti-tamper slot position | #3 anti-tamper |
| 6 ⭐ | **dict subfield sync (EQ / EQ-or-sentinel / CONST)** | **#17 counter sync** (NEW 2026-05-25 closed-loop) |

Segment 6 was added in the 2026-05-25 closed-loop — it auto-detects invisible constraints
like `PX12738 == PX12739`. The totalwine case validated this: using independent random for
PX12738/PX12739 immediately gets flagged 🔴 by this segment.

---

## Layer 3.5: 10/10 Real Hits on a PX-Gated Endpoint (3-5 min) — ⭐ Mandatory for Strict-Tier Deployments

> Under strict-tier deployments (such as totalwine), passing Layer 3 ≠ the generator is
> truly usable. You must add one more apples-to-apples test: take the generated cookie and
> actually hit an endpoint PX will block, comparing the three results "empty cookie /
> browser cookie / our cookie."
>
> ⚠️ **Precondition**: Pre-Layer-3.5's `diff_ev_ours_vs_real.py` must be all 6 segments ✅.
> Any 🔴 should not reach Layer 3.5.

**Goal**: distinguish the following three cases:
1. Our cookie genuinely lets PX edge pass through → ✅ generator OK
2. Our cookie behaves exactly like an empty cookie → the cookie content is marked trust=low by the PX backend
3. Even a browser cookie can't pass → transport/IP/TLS problem (not our generator's fault)

**Setup**:

```bash
# 1. Pick a PX-gated target URL (returns a PX block on no cookie — not a captcha, not a 200)
#    Probe method:
curl_cffi -X GET 'https://<site>/<some-srp-or-pdp-path>' \
    --impersonate chrome124 \
    --proxy 'http://<US-residential-proxy>'  # needs a US exit
# Expected: 403 + body contains "PXFF0j69T5" / "jsClientSrc" / "px-captcha"

# 2. Prepare a cookie obtained from a real browser as the control
#    Use CDP or grab it manually from Chrome devtools
```

**Test script (pseudocode, adapt to your project's `script/smoke_10x_e2e.py`)**:

```python
import time
from curl_cffi import requests

URL = 'https://<site>/<PX-gated-path>'
PROXY = 'http://<US-residential>'  # strict tier usually needs a country match

def generate_via_proxy(proxy):
    # Call your Node generator and route it through this proxy
    ...

def fetch(cookie, proxy):
    r = requests.get(URL, impersonate='chrome124', proxies={'https': proxy},
                     headers={'Cookie': cookie} if cookie else {},
                     verify=False, timeout=30)
    return r.status_code, len(r.text), 'PX-BLOCK' in r.text[:600]

# 10 independent sessions (different sticky IPs)
pass_count = 0
for i in range(10):
    session_id = f'test-{i}'
    proxy = build_proxy(session_id)
    g = generate_via_proxy(proxy)
    status, length, blocked = fetch(f'_px2={g.cookie}', proxy)
    if status == 200 and length > 100_000 and not blocked:
        pass_count += 1
        print(f'iter {i+1}: ✅ PASS {length:,}B')
    else:
        print(f'iter {i+1}: ❌ status={status} blocked={blocked}')
    time.sleep(15)   # Gotcha #13

print(f'{pass_count}/10')
```

**Pass criteria**: **10/10**. Anything < 10 is a deployment-level problem, not an
intermittent one.

### Layer 3.5 Failure Diagnosis Decision Tree

```
What's your cookie's result at the PX-gated endpoint?
├─ ❌ all PX-BLOCK (behaves the same as an empty cookie)
│   → the cookie is marked trust=low by the PX backend
│   → this is the symptom of Gotcha #15
│   → investigation order:
│       1. compare_ev2_field_by_field.py → field set / STATIC values / types
│       2. check the capture for a missing seq=2 POST (Gotcha #16)
│       3. recover-hmac-formulas.md → field-test all 4 HMAC field inputs across 6 batches
│       4. check counter subfield sync (Gotcha #17)
│
├─ ⚠️  mixed (e.g. 6/10 pass)
│   → IP quality problem: BrightData residential occasionally serves a just-burned IP
│   → increase the interval to 20-30s or switch to a higher-quality residential proxy pool
│   → not a generator bug
│
├─ ⚠️  all PX-CAPTCHA (5KB+ HTML containing the px-captcha string)
│   → the cookie wasn't accepted by PX at all (treated as "no cookie")
│   → check whether the cookie is correctly placed in the Cookie header
│   → or the URL is wrong
│
└─ ✅ 10/10 PASS
    → the generator genuinely passes the PX edge
    → you can move on to implementing business_api_demo
```

---

## Advanced Diagnosis: Use Comparison Tools

If you can't find a matching symptom in the tables above, use the comparison tools:

### A. My Generated EV2 vs Real Captured EV2 (Field-Level)

```bash
# Run the generator to dump EV2
node <site>_pxN.js --dump-ev2 > /tmp/my_ev2.json

# Compare against the real captured batch 1 EV2
python compare_my_ev2.py /tmp/my_ev2.json
```

Example output:

```
✓ 169 STATIC fields match
⚠️  RTEwewNQMUg=  value mismatch
   mine='1779263519570' (string)
   real= 1779263519570  (number)
   → gotchas #1: missing parseInt

❌🤖 BzdyfUJXdks=  extra in mine  (I have an extra /ns field)
   → gotchas #11: Grubhub EV2 shouldn't have this field
```

### B. My POST vs Real Captured POST (Byte-Level)

```bash
# Use mitmproxy or a similar tool to record the POST emitted by my generator to /tmp/my_post.txt
python diff_http.py /tmp/my_post.txt
```

Outputs header differences + param order differences + body length differences.

### C. Capture the Cookie on a Real Request, Compare Field-Level Against My Generated Cookie

```bash
# Decode my generated cookie
node -e "
const cookie = process.argv[1];
console.log(JSON.parse(Buffer.from(cookie, 'base64').toString()));
" "<my cookie value>"

# Decode the real captured cookie
node -e "..." "<real captured cookie value>"
```

See which fields differ.

---

## Common Error Cases

### Case 1: state.no String/Number Confusion

```
Symptom: collector#2 → do:null, OB only 2 segments
Buggy code:
   d['RTEwewNQMUg='] = ctx.state.no;                  // ← string '1779...'

Fix:
   d['RTEwewNQMUg='] = parseInt(ctx.state.no);        // ✅ number 1779...
```

### Case 2: UA Inconsistency

```
Symptom: collector occasionally 403s, different each time you restart the generator
Buggy code:
   const UA = 'Mozilla/5.0 ...';
   d['M2MGKXUOBB8='] = hmacMD5(uuid, UA);   // computed with the const UA
   req.headers['User-Agent'] = 'Mozilla/5.0 ...';   // ← but HTTP writes a separate copy, one extra space

Fix:
   const UA = 'Mozilla/5.0 ...';
   d['M2MGKXUOBB8='] = hmacMD5(uuid, UA);
   req.headers['User-Agent'] = UA;   // ✅ same variable
```

### Case 3: anti-tamper Position Wrong

```
Symptom: all fields correct, collector accepts the PC, but never issues a cookie
Buggy code:
   delete d[oldAntiTamperKey];
   d[newAntiTamperKey] = newValue;   // ← newKey moves to the end of the dict, iteration order changes

Fix:
   const out = {};
   for (const k of Object.keys(d)) {
       out[ANTI_TAMPER_RE.test(k) ? newAntiTamperKey : k]
         = ANTI_TAMPER_RE.test(k) ? newValue : d[k];
   }
   return out;   // ✅ rebuild the dict, preserving position
```

---

## Completion Criteria

| Dimension | Pass criteria |
|---|---|
| Layer 1 | require succeeds, smoke test 13/13 |
| Layer 2 | verify_batch 6/6 |
| Layer 3 | with interval ≥ 10s, 10 runs, 10/10 yielding distinct `_pxN` strings |
| **Pre-3.5** ⭐ | **`diff_ev_ours_vs_real.py` all 6 segments ✅** (mandatory — 2026-05-25 closed-loop requirement) |
| **Layer 3.5** | **10 independent sessions actually hitting the PX-gated endpoint, all 200 + real content** (mandatory for strict-tier deployments) |
| business API | feed the obtained cookie to the business API → 200 OK |

**All pass = done.**

⚠️ Don't treat Layer 3 as Layer 3.5:
- "cookie issued 10/10" is a necessary condition, not a sufficient one
- in iFood/Grub historical experience the two overlap, but **in strict-tier deployments they split apart**
- when writing "Validated 10/10" in the README, always make clear which layer (recommended fixed wording: "Layer 3.5: end-to-end 10/10 against `<gated-endpoint>` via `<transport>` from `<IP-tier>`")

---

## Long-Term Stability

10/10 doesn't mean "works forever." Recommended:

```bash
# Run the smoke test once a day
0 9 * * * cd /path/to/your-project && node smoke_test.js \
    || echo "smoke test failed" | mail -s "PX SDK drift?" you@example.com

# Capture a fresh batch weekly and verify the SDK SHA
0 9 * * 1 cd /path/to/your-project && \
    python ../cdp-browser/scripts/capture_via_cdp_ifood.py 99 && \
    diff <(jq .sdk_sha256 samples/{1,99}/meta.json | sort -u) \
         <(echo "1")
```

If the SDK upgrades → go through [`identify-sdk-version.md`](identify-sdk-version.md) to
assess the impact.

---

## Companion Resources

| What you want | Where |
|---|---|
| 19 gotchas in detail | [`../references/gotchas.md`](../references/gotchas.md) |
| Cross-tool relationship matrix | [`../SKILL.md`](../SKILL.md) §cross-tool relationship matrix |
| iFood generator (reference implementation) | your per-site generator (e.g. `ifood_px3.js`) |
| iFood 6 batches of samples (reference data) | your captured sample batches (e.g. `samples/`) |
| Handling SDK drift | [`identify-sdk-version.md`](identify-sdk-version.md) |

---

*Recommended: add `smoke_test.js` + `verify_all.sh` to every generator, forming a
three-layer automated test of "load validation / decode closed-loop / live 10/10." When a
new SDK ships, run it once and you immediately know whether anything broke.*
