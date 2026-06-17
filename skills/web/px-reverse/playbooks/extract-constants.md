# Playbook: Extract SDK Constants (APP_ID / TAG / FT / BI / Cookie name)

> You've landed on a **new PX-protected site**, and the first thing to do is capture its 5 protocol constants:
> AppID, TAG, FT, BI (optional), and the cookie name.
>
> These 5 values are the inputs to all subsequent reversing work. Miss one → everything downstream falls apart.
>
> Estimated time: **5-15 minutes**

---

## What you need as input

At least one of:

- **Target site URL** (e.g. `https://www.<site>.com/`) — capture live via CDP
- **One collector POST capture** (curl text or a .har file)
- **SDK file main.min.js / init.js**

## What each of the 5 constants is

| Constant | Example | Purpose |
|---|---|---|
| `AppID` | `PXO1GDTa7Q` | URL path + POST parameter `appId=` |
| `TAG` | `U0MmDhUmOnhXSw==` | PC verification salt, OB XOR key seed |
| `FT` | `401` | PC verification salt |
| `BI` | `EwNmQ0Y0IWJVVwZmCl9aYBI…` 95+ byte base64 | POST parameter `bi=`, only on some platforms |
| `Cookie name` | `_px3` or `_px2` | The final cookie name that gets set |

---

## Step 1: First capture a collector POST via CDP (most reliable)

```bash
# Start CDP Chrome
python ../cdp-browser/scripts/cdp.py start

# Navigate
python ../cdp-browser/scripts/cdp.py navigate "https://www.<target site>.com"

# Capture all collector traffic for 15 seconds
python ../cdp-browser/scripts/cdp.py network 15 | grep -E "px-cloud|sensor\." | head -10
```

The output will look something like:

```
POST https://collector-pxo1gdta7q.px-cloud.net/api/v2/collector?seq=0&rsc=1   200
POST https://collector-pxo1gdta7q.px-cloud.net/api/v2/collector?seq=1&rsc=2   200
```

→ From the URL path `pxo1gdta7q` you can recover AppID = `PXO1GDTa7Q` (first letter capitalized + the PX prefix).

## Step 2: Pull all 5 constants from the POST body

The POST body captured by CDP looks like:

```
appId=PXO1GDTa7Q&tag=U0MmDhUmOnhXSw%3D%3D&ft=401&seq=0&en=NTA&uuid=...&bi=EwNm...
```

After URL-decoding:

```
appId=PXO1GDTa7Q              ← AppID
tag=U0MmDhUmOnhXSw==           ← TAG
ft=401                          ← FT
bi=EwNmQ0Y0IWJVVwZmCl9aYBIqdA…  ← BI (if present)
```

**Done in 5 commands**:

```bash
# Assuming you saved the collector POST body to /tmp/post1.txt
PARAMS="/tmp/post1.txt"
echo "APP_ID: $(grep -oE 'appId=[^&]+' $PARAMS | head -1)"
echo "TAG:    $(grep -oE 'tag=[^&]+' $PARAMS | python -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read()))')"
echo "FT:     $(grep -oE 'ft=[^&]+' $PARAMS | head -1)"
echo "BI:     $(grep -oE 'bi=[^&]+' $PARAMS | python -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read())[:60])')"
```

> ⚠️ **Note**: use `urllib.parse.unquote` (**not** `unquote_plus`) — the `+` in base64 is a literal character and must not be replaced with a space.
> See [`../references/gotchas.md`](../references/gotchas.md) #5.

## Step 3: Find the cookie name from the captured response

```bash
# response_2.json contains the OB response, which carries a set_cookie handler
node ../scripts/decode_response.js "<TAG>" /path/to/response_2.json
```

Output:

```json
{
  "state": {...},
  "segments": [
    { "handler": "000lll", "args": ["_px3", "330", "eyJ1...", "...", "..."] },
    ...
  ]
}
```

→ Look at the first argument of the `set_cookie` segment: `_px3` or `_px2`.

## Step 3.5: ⭐ Locate BI from the SDK source (special handling)

BI is unlike the other 4 constants — it's a **long base64 string** (135-140 characters),
with no `PX*` prefix anchor like AppID has. But PX packs it together with TAG/FT/AppID in **the
same var declaration**, so **finding AppID means finding BI**:

```js
// Typical shape in the SDK (PX packs 4-5 constants under short variable names)
var jE = "U0MmDhUmOnhXSw==",      // TAG
    jF = "401",                     // FT
    jG = "PXO1GDTa7Q",               // AppID
    jH = "EwNmQ0Y0IWJVVwZmCl9aYBIq...",   // ← BI (immediately after AppID)
    jI;
```

### Method 1: grep AppID, then look at what follows (most reliable)

```bash
# First grep AppID to get the byte offset
grep -boE '"PXO1GDTa7Q"' sdk.js | head -1
# → 175:"PXO1GDTa7Q"

# Read 300 bytes forward from the AppID offset
dd if=sdk.js bs=1 skip=175 count=300 2>/dev/null
# → "PXO1GDTa7Q","EwNmQ0Y0IWJVVwZmCl9aYBIqdAQCBilmHx5z…"  ← BI is right there
```

### Method 2: grep the long base64 literal directly (second most reliable)

```bash
# BI is 100+ char base64, TAG is usually 12-20 chars — filter by length
grep -oE '"[A-Za-z0-9+/=]{100,200}=="' sdk.js | head -5
```

The output will have a few candidates (BI plus other long base64 hashes); pick by hand — BI
is the **only one ending in `==` and 130+ characters long**.

### Method 3: grep the whole var declaration (most complete)

```bash
# Find the var line that declares the 4 constants
grep -oE 'var\s+\w+\s*=\s*"[A-Za-z0-9+/=]{12,}=="[^;]{0,300}' sdk.js | head -3
```

This will hit the TAG line (which starts with TAG), followed by FT, AppID, and BI.
Just read the full original text.

### Cross-version observations (2026-05 vs older)

| Era | First 30 chars of BI | Length | SDK variable name |
|---|---|---|---|
| Old (~2024) | `dgoMBiMxRCcwUmMjb1o/JXcvEUFnA0…` | 140 | `Et = "dgoMBi…"` |
| New (2026-05) | `EwNmQ0Y0IWJVVwZmCl9aYBIqdAQCBilm…` | 136 | `jH = "EwNm…"` |

**Key takeaways**:

- **The variable name changed** (`Et` → `jH`) — locating by variable name is not portable
- **The BI value changed** (it rotates on every SDK upgrade)
- **The method ("the long base64 right after AppID") is portable across versions**

### Does the server actually check BI?

Empirical observations:

- The `bi=` value across all 6 capture batches is **identical** (not dynamically generated)
- It does not participate in PC computation (the PC salt is `uuid:tag:ft`, no bi)
- It does not participate in OB decoding (the XOR key comes from ml(TAG))
- It does not participate in anti-tamper (which uses state.to/no)

**Conclusion**: BI is most likely used by PX for **passive telemetry**, and the **server does not strictly validate its contents**.

Experimental verification (if you want to confirm):

```bash
# Change BI to all A's in the generator, then run it
sed -i "s/const BI = '[^']*'/const BI = 'A'.repeat(136)/" your_generator.js
node your_generator.js
# If it still produces _px3 → the server really doesn't check BI's contents
```

But **to be safe**, still use the real value from the SDK. If PX ever adds BI validation, all-A's would break.

---

## Step 4: Verify against the SDK file (confirm all 5 constants are present)

Download the SDK and verify the constants really are in the source:

```bash
curl "https://client.px-cloud.net/<APP_ID>/main.min.js" > sdk.js
# or
curl "https://sensor.<site>.com/<short_id>/init.js" > sdk.js

# Verify all 4 constants are in the source (each should hit ≥ 1 time)
for c in '"PXO1GDTa7Q"' '"U0MmDhUmOnhXSw=="' '"401"' '"_px3"'; do
    echo "$c: $(grep -c "$c" sdk.js) hits"
done
```

Expected: each constant is grep-able in the SDK. If a constant hits 0 times, the SDK may
reference it indirectly through the hQ dictionary — in that case you need to extract the hQ
dictionary first (see [`identify-sdk-version.md`](identify-sdk-version.md)).

---

## Fallback location strategies (if direct grep fails)

In priority order (move to the next only when the previous fails):

### Strategy A: PX business prefix regex (most reliable)

```bash
grep -boE '"PX[A-Za-z0-9]{8,15}"' sdk.js | head -3
# → 0:175  "PXO1GDTa7Q"
```

PX customer AppIDs always begin with `PX` + 8-15 characters — this is a PX naming convention, unchanged across versions.

### Strategy B: search for a global export (Grubhub style)

```bash
grep -boE 'window\._px[a-zA-Z]+\s*=' sdk.js | head -5
# → window._pxAppId = "PXO97ybH4J"
```

Some PX deployments (e.g. Grubhub) expose the AppID on `window`.

### Strategy C: search for common FT values

```bash
grep -boE '"(330|388|401|359|421)"' sdk.js | head -5
```

PX's common FT values fall among these. After a hit, look at the context — TAG and AppID are usually nearby on the same line.

### Strategy D: search for the base64 form of the collector URL

```bash
# base64 of /api/v2/collector = L2FwaS92Mi9jb2xsZWN0b3I=
grep -boE '"L2FwaS92Mi9jb2xsZWN0b3I' sdk.js
```

Some platforms (Grubhub) also store the endpoint URL in base64 form, right next to the AppID.

### Strategy F: find BI's "immediately after AppID" pattern ⭐

See Step 3.5. This pattern is the most version-stable — because PX packing 4-5 constants into
the same var declaration is hard-coded into their build pipeline (unchanged for 3 years).

### Strategy E: read it directly from the browser Console

If you're in a real browser:

```js
window._pxAppId      // → "PXO1GDTa7Q"
document.cookie       // inspect existing _px* cookies to infer the cookie name
```

---

## Verify the collected constants are correct

```bash
# Decoding a captured POST with these 5 constants should produce valid JSON
node ../scripts/decode_payload.js /path/to/post1.txt
# If the output is valid JSON like [{"t":"...","d":{...}}] → the constants are right

# Decoding an OB response with the TAG should yield state.*
node ../scripts/decode_response.js "<TAG>" /path/to/response1.json
# If the output is { "state": { "no": "...", "to": "...", ... } } → the TAG is right
```

**If the decode output is garbage** → one of the 5 constants is wrong; re-check them.

---

## Decision tree: where to go after you have the constants

```
Got AppID / TAG / FT
  │
  ├─ Want to know whether this SDK version is a known one
  │     → see identify-sdk-version.md
  │
  ├─ Want to capture 6 sample batches and start reversing
  │     → see build-generator.md
  │
  └─ Can't even capture a collector POST (403 at the front layer)
        → TLS fingerprint issue, you must use real Chrome + CDP
        → don't use Selenium / Playwright
```

---

## Companion resources

| What you want | Where to go |
|---|---|
| grep pattern details | [`../references/locate-by-pattern.md`](../references/locate-by-pattern.md) §5.3 |
| Cross-platform constant comparison (iFood vs Grubhub) | [algorithm-chain.md](../references/algorithm-chain.md) |
| The `+` character pitfall when decoding base64 | [`../references/gotchas.md`](../references/gotchas.md) #5 |
| Ready-made iFood + Grubhub constant comparison | Same document as above, §8 |

---

*Average extraction time: iFood 5 minutes, Grubhub 10 minutes (the extra time is because its constants are scattered).*
