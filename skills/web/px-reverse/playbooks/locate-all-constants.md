# Playbook: A Unified Methodology for Locating the 5 Constants in PX SDK Source

> Given any PX SDK file, find all 5 constants (AppID / TAG / FT / BI /
> Cookie name + GT/Collector URL) **within 5 minutes**.
>
> Core principle: anchor on **cross-version-stable signatures**, never variable
> names or line numbers.

---

## Overview: How to Find the 5 Constants

| Constant | Length | Cross-version signature | One-line grep |
|---|---|---|---|
| **AppID** | 10-13 chars | `"PX"` prefix + 8-15 char ID | `grep -boE '"PX[A-Za-z0-9]{8,15}"' sdk.js` |
| **TAG** | 12-20 chars (base64 with `==`) | Same `var` declaration as AppID | Derived from AppID (see below) |
| **FT** | 3-digit number (string) | Numeric string in the same `var` declaration | `grep -oE '"(330\|388\|401\|359\|421)"' sdk.js` |
| **BI** | 100-200 char base64 | Same `var` declaration as AppID, the longest base64 | Derived from AppID (see below) |
| **Cookie name** | `_px2` / `_px3` | First argument of the OB response's set_cookie segment | `grep -boE '"_px[0-9]"' sdk.js` |
| **GT (OB XOR key seed)** | 12-20 char base64 | Argument to the `ml(...)` call | `grep -oE 'ml\(\s*"[A-Za-z0-9+/=]{8,}=' sdk.js` |
| **Collector URL** | URL | Plain literal or base64 form | `grep -boE '"/api/v2/collector"' sdk.js` |

---

## Core Mental Model

PX packs 4-5 of these constants into the **same `var` declaration line** (this is
hard-wired in the PX build pipeline and has not changed in 3 years):

```js
var jE = "U0MmDhUmOnhXSw==",                          // TAG (12-20 chars)
    jF = "401",                                         // FT (3-digit number string)
    jG = "PXO1GDTa7Q",                                   // AppID ("PX" prefix)
    jH = "EwNmQ0Y0IWJVVwZmCl9aYBIqdAQCBilm...",         // BI (100-200 char base64)
    jI;                                                  // placeholder
```

The variable names `jE/jF/jG/jH/jI` are reshuffled by each obfuscation pass, but
the **structure is always the same**:

- 5 variables declared together, comma-separated
- 4 string literals plus 1 undefined (the trailing `jI`) in the middle
- Order: TAG -> FT -> AppID -> BI

**Conclusion: find the AppID and you have found all 4 constants.**

---

## Step 1: Locate the AppID (the anchor)

### Method 1.1: Use the PX business prefix (most stable)

```bash
grep -boE '"PX[A-Za-z0-9]{8,15}"' sdk.js | head -3
# output:
#   175:"PXO1GDTa7Q"
```

**Why it is stable**: the AppID PX issues to a customer is always `PX` + 8-15
chars. **No exception seen in 3 years.**

### Method 1.2: Search for a global exposure (only on some platforms)

```bash
grep -boE 'window\._pxAppId\s*=\s*"[^"]+"' sdk.js
# output (Grubhub):
#   139:window._pxAppId="PXO97ybH4J"
```

The Grubhub-style build exposes the AppID on `window._pxAppId` for customer
troubleshooting. iFood does not.

### Method 1.3: Derive it from the collector URL

```bash
grep -boE '"https?://collector-[a-z0-9]+\.px-cloud\.net/' sdk.js
# or sensor.<host>.com
```

The hostname is `collector-<lowercase AppID>.px-cloud.net`, so you can recover the
AppID from the URL.

---

## Step 2: From the AppID Position, Locate TAG / FT / BI

Once you have the AppID byte offset, **look 300-500 bytes around it** to find
TAG/FT/BI in full:

```bash
# 1. get the AppID byte offset
APP_POS=$(grep -boE '"PXO1GDTa7Q"' sdk.js | head -1 | cut -d: -f1)

# 2. read 400 bytes before the AppID (TAG/FT come first) + 300 bytes after (BI follows)
dd if=sdk.js bs=1 skip=$((APP_POS - 400)) count=700 2>/dev/null
```

Actual output (iFood):

```
var jE="U0MmDhUmOnhXSw==",jF="401",jG="PXO1GDTa7Q",jH="EwNmQ0Y0IWJVVwZmCl9aYBIqdAQCBilm...",jI;
   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   TAG                          FT      AppID            BI (the long one)
```

Extract all 4 at once:

```bash
# field splitting
dd if=sdk.js bs=1 skip=$((APP_POS - 400)) count=700 2>/dev/null \
  | grep -oE 'var\s+\w+="[^"]+","[^"]+","[^"]+","[^"]+"' \
  | head -1
# -> var jE="TAG",jF="FT",jG="AppID",jH="BI"
```

---

## Step 3: Locate GT (the OB XOR key seed)

GT is the XOR key seed used to decode the OB response. It is **not the TAG** (many
SDKs coincidentally share the same value for both, which is why they get confused).
GT is the input argument to the `ml()` function.

### Method 3.1: grep for the `ml(...)` call

```bash
grep -oE 'ml\(\s*"[A-Za-z0-9+/=]{8,}=' sdk.js | head -3
# output:
#   ml("DhY8E0h7J2cKHw==
```

### Method 3.2: Derive it from captured traffic

If the GT grep returns nothing (the `ml` name may be obfuscated), you can derive
it:

```bash
# for each candidate base64 constant, compute ml(x) % 128 and see which one equals the real OB XOR key
for candidate in <list-of-base64-constants-from-SDK>; do
    key=$(node -e "
        const ml = require('revers/ob').ml;
        console.log(parseInt(ml('$candidate'), 10) % 128);
    ")
    echo "GT candidate '$candidate' -> XOR key = $key"
done
```

**Measured on iFood**: GT = TAG = `U0MmDhUmOnhXSw==`, but **not every SDK does
this** (older versions have GT != TAG).

---

## Step 4: Locate the Cookie Name

### Method 4.1: grep `_pxN` directly

```bash
grep -boE '"_px[0-9]"' sdk.js | head -5
# output:
#   ...:"_px3"
#   ...:"_px2"
#   ...:"_pxhd"     <- this is the history cookie, not the main cookie
#   ...:"_pxvid"    <- visitor ID cookie
```

An SDK usually contains both `_px2` and `_px3` (compatibility code); the **main
cookie is whichever one the set_cookie handler uses**.

### Method 4.2: Confirm from the OB#2 response set_cookie segment

```bash
node ../scripts/decode_response.js "<TAG>" /path/to/response_2.json
# output contains: { "segments": [..., { args: ["_px3", "330", "eyJ1..."] }, ...] }
```

The first argument of the set_cookie segment is the cookie name actually in use.

---

## Step 5: Locate the Collector URL

### Method 5.1: grep the plaintext

```bash
grep -boE '"https://collector-[a-z0-9]+\.px-cloud\.net/api/v2/collector"' sdk.js
grep -boE '"/api/v2/collector"' sdk.js
```

### Method 5.2: grep the base64 form (Grubhub style)

```bash
# base64 of "/api/v2/collector" = L2FwaS92Mi9jb2xsZWN0b3I=
grep -boE 'L2FwaS92Mi9jb2xsZWN0b3I' sdk.js
```

Some platforms (Grubhub) store the endpoint URL **both as plaintext and base64** —
the latter may be used in scan-evasion scenarios.

---

## Cross-Vendor Comparison (proving the method is version-agnostic)

### iFood (2026-05)

```js
// 4 constants in one line
var jE="U0MmDhUmOnhXSw==",jF="401",jG="PXO1GDTa7Q",jH="EwNm...",jI;
```

| Constant | Value |
|---|---|
| AppID | `PXO1GDTa7Q` |
| TAG | `U0MmDhUmOnhXSw==` |
| FT | `401` |
| BI | `EwNmQ0Y0IWJVVwZm...` (136 chars) |
| GT | `U0MmDhUmOnhXSw==` (= TAG) |
| Cookie | `_px3` |

### Grubhub (2026-05)

```js
// AppID exposed globally
window._pxAppId = "PXO97ybH4J"
// other constants are scattered (not in a single var! this is a vendor difference)
yt = "FmYgK1gdJEAP"   // TAG (on its own line)
gt = "359"             // FT
bt = "PXO97ybH4J"       // AppID (repeated)
```

| Constant | Value |
|---|---|
| AppID | `PXO97ybH4J` |
| TAG | `FmYgK1gdJEAP` |
| FT | `359` |
| BI | (some Grubhub SDKs have no BI field) |
| Cookie | `_px2` |

**Key observations**:

- ✅ The AppID always uses the `"PX..."` prefix -> grep is stable across versions
- ✅ TAG / FT character signatures are unchanged across versions (base64 with `==` / 3-digit number)
- ⚠️ **Packaging differs by vendor** (iFood puts 4 in one line, Grubhub scatters them)
- ⚠️ BI is **not present on every platform** (omitted in some Grubhub configurations)

---

## One-Liner: Full 5-Constant Extraction (iFood style)

```bash
SDK="path/to/main.min.js"

# AppID
APP_ID=$(grep -oE '"PX[A-Za-z0-9]{8,15}"' "$SDK" | head -1 | tr -d '"')
echo "AppID: $APP_ID"

# read 400 bytes before + 300 bytes after the AppID byte offset
APP_POS=$(grep -boE '"'$APP_ID'"' "$SDK" | head -1 | cut -d: -f1)
RANGE=$(dd if="$SDK" bs=1 skip=$((APP_POS - 400)) count=700 2>/dev/null)

# TAG (first base64 ending in ==)
TAG=$(echo "$RANGE" | grep -oE '"[A-Za-z0-9+/]{12,}=="' | head -1 | tr -d '"')
echo "TAG: $TAG"

# FT (3-digit number string)
FT=$(echo "$RANGE" | grep -oE '"(330|388|401|359|421|330|421)"' | head -1 | tr -d '"')
echo "FT:  $FT"

# BI (the longest base64)
BI=$(echo "$RANGE" | grep -oE '"[A-Za-z0-9+/=]{100,200}=="' | head -1 | tr -d '"')
echo "BI:  $(echo $BI | cut -c1-30)... ($(echo -n $BI | wc -c) chars)"

# Cookie name
COOKIE=$(grep -boE '"_px[0-9]"' "$SDK" | head -1 | sed 's/.*"_px\([0-9]\)"/_px\1/')
echo "Cookie: $COOKIE"
```

**Typical output (iFood 2026-05)**:

```
AppID: PXO1GDTa7Q
TAG: U0MmDhUmOnhXSw==
FT:  401
BI:  EwNmQ0Y0IWJVVwZmCl9aYBIqdAQCBilm... (136 chars)
Cookie: _px3
```

---

## Decision Tree: When a Constant Will Not grep

```
AppID not found?
  ├─ "PX" prefix regex did not match
  │     → try window._pxAppId
  │     → still nothing? derive it from the SDK load URL path
  └─ multiple candidates
        → compare against the lowercase part of the collector URL path, pick the match

TAG not found?
  ├─ is there a base64-with-== within 400 bytes before the AppID offset?
  │     → yes → that is the TAG
  ├─ Grubhub-style scattered, no TAG near the AppID
  │     → search the whole SDK for a standalone var:
  │       grep -oE 'var\s+\w{1,3}\s*=\s*"[A-Za-z0-9+/]{8,16}=="' sdk.js
  └─ the TAG may not be in the source at all; capture it from the collector POST
        → Step 2: capture the collector POST and read the tag= parameter

FT not found?
  ├─ search before the AppID for a "3-digit number string"
  │     → usually one of 330/359/388/401/421
  └─ search globally: grep -oE '"[0-9]{3}"' sdk.js | sort -u
        → pick the candidate whose value makes "semantic" sense (FT correlates with the collector URL style)

BI not found?
  ├─ is there a 100+ char base64 within 300 bytes of the AppID?
  │     → yes → that is the BI
  └─ genuinely absent
        → some PX configurations do not send the bi= field
        → check the real POST: grep -oE 'bi=[^&]+' real_request.txt
          no result = this PX deployment does not use BI

Cookie name not found?
  ├─ grep '_px2' / '_px3' both miss
  │     → the SDK references it indirectly via the hQ dictionary; extract hQ first
  └─ both _px2 and _px3 hit once each
        → check which one the set_cookie handler actually writes
```

---

## Cross-Version Stability Summary

| Constant | Version-stable | Vendor-stable | Difficulty |
|---|---|---|---|
| AppID | ✅ "PX" prefix hard-wired | ✅ | ⭐ easiest |
| TAG | ✅ base64 ending in `==` | ✅ | ⭐⭐ easy (free once you find the AppID) |
| FT | ✅ 3-digit number string | ✅ | ⭐⭐ easy |
| BI | ✅ 100+ char base64 | ⚠️ absent on some platforms | ⭐⭐ easy |
| Cookie name | ⚠️ _px2 → _px3 across major versions | ✅ | ⭐ easiest |
| GT (OB XOR seed) | ✅ ml() input | ✅ | ⭐⭐⭐ medium (sometimes requires derivation) |
| Collector URL | ✅ literal or base64 | ✅ | ⭐ easiest |

---

## Related Resources

| What you want | Where |
|---|---|
| Real iFood vs Grubhub side-by-side | [algorithm-chain.md](../references/algorithm-chain.md) |
| Extracting constants from traffic (runtime) | [`extract-constants.md`](extract-constants.md) |
| How to tell whether an SDK is PX | [`identify-sdk-version.md`](identify-sdk-version.md) |
| Full grep pattern index | [`../references/locate-by-pattern.md`](../references/locate-by-pattern.md) |

---

*This methodology has held for every PX SDK observed in 3 years (iFood, Grubhub,
and cross-quarter SDK upgrades). If a constant will not grep, consult the decision
tree first, then consider that it may be a wholesale PX refactor (extremely rare).*
