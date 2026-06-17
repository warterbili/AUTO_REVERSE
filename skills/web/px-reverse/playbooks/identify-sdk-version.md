# Playbook: Identify the SDK Version / Determine Whether It Was Upgraded

> Your generator **worked yesterday but not today** — did PX upgrade the SDK?
> Or you've got a **new SDK file** and need to determine whether it's PX, which version, and how far it diverges from a known version.
>
> Estimated time: **2-10 minutes**

---

## Three scenarios, and how to handle each

### Scenario A: Determine whether a .js file **is** a PX SDK

```bash
SDK="path/to/main.min.js"

# Any one of the 5 magic constants hitting = it's PX
echo "MD5 init (1732584193):    $(grep -c 1732584193 "$SDK")"
echo "HMAC ipad (909522486):    $(grep -c 909522486 "$SDK")"
echo "UUID v1 (122192928e5):    $(grep -c 122192928e5 "$SDK")"
echo "ml() (2147483647):        $(grep -c 2147483647 "$SDK")"
echo "base91 alphabet (F@bt):   $(grep -c "F@bt" "$SDK")"
```

**Verdict**:

- 5/5 hits → ✅ standard PX SDK
- 4/5 hits → ⚠️ possibly a PX variant or trimmed build, investigate deeper
- 3/5 hits → ⚠️⚠️ probably not PX
- ≤2/5 hits → ❌ not PX (look at Akamai / Cloudflare / DataDome instead)

These 5 constants are RFC standards + PX-chosen magic numbers, and have **never changed in 3 years**.

### Scenario B: Identify the "minor version" of a PX SDK (version differences within the same site)

```bash
# 1. Compute SHA-256
sha256sum "$SDK"
# → b47a639cde9df4f91bdc4138ae0d64ebf7ce8c876a1e4c9967fd3af3d2975eb8

# 2. Compare against known versions
cat source/SDK_INFO.md | grep "SHA-256"
# → b47a639c... = same version

# 3. If the SHA differs, check whether the size is close
ls -la "$SDK" source/main.min.js
# size diff < 5%  → same major version, minor update (hQ dictionary rotation, minor field tweaks)
# size diff > 10% → major version (possibly new fields or an added captcha path)
```

### Scenario C: Determine **how far** this SDK diverges from a version you know

```bash
NEW_SDK="new.min.js"
OLD_SDK="source/main.min.js"

# Item-by-item comparison
for f in "$NEW_SDK" "$OLD_SDK"; do
    echo "── $f ──"
    echo "  size:           $(wc -c < $f) bytes"
    echo "  AppID:          $(grep -oE '"PX[A-Za-z0-9]{8,15}"' $f | head -1)"
    echo "  TAG (candidate): $(grep -oE 'var\s+\w+\s*=\s*"[A-Za-z0-9+/=]{12,}=="' $f | head -1)"
    echo "  FT (candidate):  $(grep -oE '"(330|388|401|359|421)"' $f | head -1)"
    echo "  endpoints:       $(grep -oE '"/api/v2/collector"' $f | head -1)"
    echo "  hP[0]:          $(grep -oE 'hP\s*=\s*\[\s*"[^"]{1,30}"' $f | head -1 | cut -c1-50)"
done
```

**Types of change**:

| What changed | Severity | Follow-up action |
|---|---|---|
| Any of AppID / TAG / FT changed | ⭐⭐⭐⭐⭐ severe | All generators are dead, update all constants |
| Line numbers changed (similar size, different SHA) | ⭐ minor | The generator is **usually** unaffected (it locates by grep pattern, not line numbers) |
| The hP[0] string changed | ⭐⭐⭐ moderate | hQ dictionary rotated, all b64 keys may need re-matching by value |
| Size diff > 10% | ⭐⭐⭐⭐ heavy | Possibly new functionality (e.g. a Bundle path), inspect the new parts |
| The algorithm constants (5 magic constants) no longer hit | ⭐⭐⭐⭐⭐ fatal | PX's algorithm itself changed — not seen in 3 years |

---

## Step 1: Fetch a fresh SDK

```bash
# Option A: pull directly from the CDN (fastest)
APP_ID="PXO1GDTa7Q"   # replace with the target site's AppID
curl -sS "https://client.px-cloud.net/${APP_ID}/main.min.js" > new_sdk.js

# Option B: capture in the browser via CDP (most reliable, confirms the browser really uses this version)
python ../cdp-browser/scripts/cdp.py navigate "https://www.<site>.com/"
python ../cdp-browser/scripts/cdp.py network 5 | grep -E "main\.min\.js|init\.js"

# Option C: use the fetch_sdk script (auto-computes SHA, saves the file)
python ../cdp-browser/scripts/fetch_sdk.py
```

## Step 2: Run the 5-point probe

```bash
SDK="new_sdk.js"
echo "=== PX SDK probe ==="
echo "MD5 init:       $(grep -c 1732584193 "$SDK")"
echo "HMAC ipad:      $(grep -c 909522486 "$SDK")"
echo "UUID v1:        $(grep -c 122192928e5 "$SDK")"
echo "ml() INT32_MAX: $(grep -c 2147483647 "$SDK")"
echo "base91 alphabet: $(grep -c "F@bt" "$SDK")"
echo "OB separator:    $(grep -c '~~~~' "$SDK")"
echo "SID stego:       $(grep -c "0xE0100\|fromCodePoint" "$SDK")"
echo "anti-tamper:    $(grep -cE "% *10 *\+ *[12]" "$SDK")"
echo "/api/v2/coll:   $(grep -c '/api/v2/collector' "$SDK")"
echo "fallback ts:    $(grep -c '1604064986' "$SDK")"
echo ""
echo "SDK size:        $(wc -c < "$SDK") bytes"
echo "SHA-256:        $(sha256sum "$SDK" | cut -d' ' -f1)"
```

**Typical output (iFood 2026-05)**:

```
MD5 init:       1
HMAC ipad:      1
UUID v1:        1
ml() INT32_MAX: 1
base91 alphabet: 1
OB separator:    1
SID stego:       1     ← used by iFood, Grubhub is 0
anti-tamper:    2
/api/v2/coll:   1
fallback ts:    1

SDK size:        231438 bytes
SHA-256:        b47a639cde9df4f91bdc4138ae0d64ebf7ce8c876a1e4c9967fd3af3d2975eb8
```

## Step 3: Compare against the existing SDK_INFO.md

```bash
# Look at the SHA of the known SDKs in this project
for f in */source/SDK_INFO.md; do
    site=$(echo "$f" | cut -d/ -f1)
    sha=$(grep -oE '[a-f0-9]{64}' "$f" | head -1)
    echo "  $site: $sha"
done

# Compare against the new_sdk.js I just fetched
NEW_SHA=$(sha256sum new_sdk.js | cut -d' ' -f1)
echo "  new:   $NEW_SHA"
```

**Verdict**:

- Same SHA → same version, nothing to do
- Different SHA + same size (±5%) → minor version (hQ rotation)
- Different SHA + large size difference → major version (functional changes)

## Step 4: If the SDK changed, assess the impact on the generator

### 4.1 Test the new SDK with the existing decoder

```bash
# Capture 1 fresh sample batch (using the new SDK)
python ../cdp-browser/scripts/capture_via_cdp_ifood.py 100  # batch 100 = test batch

# Decode the new batch with the existing TAG
node ../scripts/decode_payload.js samples/100/request_2.txt
```

**Result classification**:

| Decode result | Meaning | Severity |
|---|---|---|
| ✅ Valid JSON comes out | TAG unchanged, algorithm layer OK | The generator **most likely** still works; run verify_batch once to confirm |
| ❌ JSON decodes but all field names differ | hQ dictionary rotated, base64 keys reshuffled | Templates and key mapping must be redone |
| ❌ Total garbage | TAG or ml() algorithm changed | Re-run extract-constants to pull the constants |

### 4.2 Run verify_batch on the existing samples to see if the decoder still works

```bash
bash verify_all.sh
# pass → the decoder is portable to the current SDK, the generator layer is most likely fine too
# fail → see which stage failed: constants / algorithm / fields all need re-mapping
```

### 4.3 Run the existing generator + a live test

```bash
node ifood_px3.js   # your per-site generator
# returns { cookie_name: "_px3", cookie_value: "..." } → the generator still works ✅
# returns { error: "..." } → inspect the specific error
```

## Step 5: Decide the next step based on severity

```
New SDK probe done
  │
  ├─ All 5 magic constants pass + existing generator still gets a cookie
  │     → ✅ nothing to do, just update the SHA in SDK_INFO.md
  │
  ├─ Existing generator can't get a cookie, but the decoder still works
  │     → fields or templates changed — run diff_samples.py on the existing
  │       samples to see which field values changed, then update the templates
  │
  ├─ Decoder no longer works (garbage output)
  │     → TAG or ml() algorithm changed — go through extract-constants to re-extract
  │
  └─ Some of the 5 magic constants fail
        → not seen in 3 years — did the SDK vendor actually change? Or did you grab the wrong file?
        → re-fetch the SDK (Step 1)
```

---

## Decision tree quick reference

```
What I have            Where to go next
─────────────────    ────────────────────────────────
1 .js file           Steps 1-2: run the probe
My generator failed  Step 4.3 → inspect the error
SHA differs from mine Steps 4.1 + 4.2
PX major upgrade     Re-run the full build-generator.md
```

---

## Year-over-year stability reference

PX's SDK upgrade pattern over the past 3 years:

| Frequency | What changed |
|---|---|
| Weekly | (almost nothing) |
| Every 2-3 weeks | captcha.js (Bundle path) |
| Quarterly | main.min.js (hQ dictionary rotation, variable renaming) |
| Every 6 months | occasional field rotation |
| Yearly | occasional new fields |
| Never observed | RFC-standard algorithm constants changing |
| Never observed | protocol separators `~~~~` `\|` changing |
| Never observed | major endpoint URL changes |

**Conclusion**: build the generator on the **algorithm layer + RFC constants** → stable across quarters.
Build it on **variable names / line numbers** → it breaks every time.

---

## Companion resources

| What you want | Where to go |
|---|---|
| Full grep pattern index | [`../references/locate-by-pattern.md`](../references/locate-by-pattern.md) |
| Cross-version stability matrix | [algorithm-chain.md](../references/algorithm-chain.md) |
| How to extract constants from a new SDK | [`extract-constants.md`](extract-constants.md) |
| Full steps to rebuild the generator | [`build-generator.md`](build-generator.md) |

---

*The core cross-version principle: **don't rely on line numbers, don't rely on variable names — rely only on algorithm constants and control-flow features.***
