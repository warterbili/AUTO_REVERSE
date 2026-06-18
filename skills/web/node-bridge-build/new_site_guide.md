# New-Site Bridge Adaptation Tutorial (9-step walkthrough)

> Adapt the iFood template to a new site. **Each step explicitly notes which upstream skill to use.**
>
> Assume the new site is called `<site>`; the goal is to produce `node_bridge/<site>/` + get it working and obtain the target cookie.

> 🔝 **When it does not work, upgrade to sdenv**: [https://github.com/pysunday/sdenv](https://github.com/pysunday/sdenv)
> For the decision criteria, see "What to do when it does not work" at the end + [`methodology.md §7`](methodology.md#7-when-to-upgrade-to-sdenv).

---

## Workflow overview

```
[1] Capture + lock the SDK         ← cdp-browser
[2] Identify basic constants       ← read the SDK / capture real requests
[3] Copy the ifood template        ← bash
[4] Change SDK path + constants    ← Edit
[5] Dump real Chrome fingerprints  ← cdp-browser ⭐
[6] First run + collect crashes    ← jni-env-patching ① + ②
[7] Configure the TLS layer        ← curl_cffi_integrate
[8] Differential comparison + iterate ← cdp-browser + jni-env-patching ③
[9] Validate + write the journal   ← live_validation
```

Estimated total time **4-8 hours** (same PX vendor, first time doing it).

---

## Step 1: Capture + lock the SDK

**Skill used**: `cdp-browser`

```bash
# launch Chrome + visit the target site
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py start
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py navigate "https://www.<site>.com"

# capture the SDK load request (the PX SDK URL usually contains client.px-cloud.net or sensor.<site>.com)
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py network 15 | \
    jq '.[] | select(.request.url | test("client\\.px-cloud|sensor\\.|main\\.min\\.js"))'

# download and lock the SDK (via mitmproxy / curl / DevTools save-as)
curl -o stample/<site>/source/main.min.js https://client.px-cloud.net/<APP_ID>/main.min.js
sha256sum stample/<site>/source/main.min.js > stample/<site>/source/SDK_INFO.md
```

**Expected output**: `stample/<site>/source/main.min.js` (locked SDK) + a SHA256 record.

---

## Step 2: Identify basic constants

Capture the real collector POST request from the page that loads the SDK, and extract 4 constants:

| Constant | How to find it | Example (iFood) |
|---|---|---|
| **AppID** | SDK URL path / collector URL host | `PXO1GDTa7Q` |
| **Collector URL** | DevTools Network, look at the collector POST domain | `https://collector-pxo1gdta7q.px-cloud.net/api/v2/collector` |
| **Cookie name** | the response's set-cookie / `do` array bake instruction | `_px3` (iFood) / `_px2` (Grubhub) |
| **Target domain** | the business API main domain | `cw-marketplace.ifood.com.br` |

```bash
# use cdp-browser to capture the collector POST and extract the AppID
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py network 20 | \
    jq '.[] | select(.request.url | contains("collector")) | .request.url'
# → https://collector-PXOXXXXXX.px-cloud.net/api/v2/collector?app=PXOXXXXXX&tag=...
#                                                            ↑ AppID
```

**Expected output**: the 4 constants recorded in stample/<site>/source/SDK_INFO.md.

---

## Step 3: Copy the ifood template

```bash
cd <repo-root>
cp -r node_bridge/ifood node_bridge/<site>
cd node_bridge/<site>

# put the locked SDK in place
cp ../../stample/<site>/source/main.min.js perimeterx/

# clear out iFood leftovers
rm -rf node_modules .checkpoint
```

**Expected output**: a complete `node_bridge/<site>/` directory containing the iFood template code + the new site's SDK.

---

## Step 4: Change SDK path + constants

Change the constants in **3 files** (use grep to find the locations):

### 4.1 `px_node_bridge.js` — change the SDK path (if the SDK file name is different)

```javascript
// defaults to main.min.js — if the SDK file name is init.js / sensor.js or similar, change this line
const pxSdkPath = path.join(__dirname, 'perimeterx/main.min.js');
```

### 4.2 `px_cookie_generator.py` — change 4 constants

```python
# original iFood:
SITE_BASE      = "https://www.ifood.com.br"
COLLECTOR_BASE = "https://collector-pxo1gdta7q.px-cloud.net"
APP_ID         = "PXO1GDTa7Q"
COOKIE_NAME    = "_px3"

# change to <site>:
SITE_BASE      = "https://www.<site>.com"
COLLECTOR_BASE = "https://collector-<appid_lowercase>.px-cloud.net"
APP_ID         = "<APP_ID>"
COOKIE_NAME    = "_px<2or3>"
```

### 4.3 `px-node-env/env/builder.js` — change targetUrl

```javascript
buildEnvironment({
    targetUrl: 'https://www.<site>.com',     // ← change here
    userAgent: '...'                          // usually unchanged (chrome131)
})
```

**Expected output**: all 4 constants correspond to the new site.

---

## Step 5: Dump real Chrome fingerprints (the critical step) ⭐

**Skill used**: `cdp-browser`

Run the 5 command groups from [`methodology.md §3 dump templates`](methodology.md#3-cdp-browser-skill-detailed-dump-templates-paste-and-use), and paste the output **directly** into the corresponding env files:

```bash
# 5.1 navigator → paste into env/navigator.js
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py navigate "https://www.<site>.com"
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py eval "
  JSON.stringify({...})   # use the full template from methodology.md §3.1
" > /tmp/<site>_navigator_dump.json

# 5.2 screen + window → paste into env/builder.js + env/px_intercept.js
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py eval "
  JSON.stringify({...})   # use methodology.md §3.2
" > /tmp/<site>_screen_dump.json

# 5.3 window enumerable keys → paste into env/px_intercept.js
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py eval "
  Object.keys(window).filter(k => !k.startsWith('_')).sort()
" > /tmp/<site>_window_keys.json

# 5.4 Canvas hash calibration (use methodology.md §3.4)
# → run the same JS through our bridge → diff the hash → adjust env/canvas.js
```

**Key point**: paste the dumped real values **field by field** into the hardcoded sections of the corresponding env/*.js.

**Expected output**:
- `env/navigator.js` containing the full navigator properties of real Chrome
- `env/builder.js` containing the real screen / window dimensions
- `env/px_intercept.js` containing the complement of real Chrome's `Object.keys(window)` difference set

---

## Step 6: First run + collect crashes

```bash
cd node_bridge/<site>
npm install --ignore-scripts
npm install canvas@3        # Windows must use @3 prebuilt

# run the Python coordinator (with proxy)
SESSION="$(date +%s)$RANDOM"
export HTTPS_PROXY="http://<user>:<pwd>@<host>:<port>"   # matching the region <site> is in
python px_cookie_generator.py 2>&1 | tee /tmp/<site>_first_run.log
```

**The first run typically crashes.** Look at `[NODE]` stderr:

| Crash type | jni-env-patching step | Fix |
|---|---|---|
| `TypeError: Cannot read property X of undefined` | ① identify the crash | X is missing → patch it into the corresponding env file |
| `TypeError: navigator.userAgentData.brands is not a function` | ① + ② | userAgentData missing → patch env/navigator.js |
| `TypeError: window.AudioContext is not a constructor` | ① + ② | AudioContext missing → patch env/audio.js |
| SDK does not crash but PX returns 403 / px-captcha | ③ the reasonable value is wrong | Jump to Step 8 differential comparison |

Handle each crash:
1. See which API the error is in
2. **Use cdp-browser to dump the real Chrome value of the corresponding API** (jni-env-patching ② "inspect the real environment")
3. Paste it into the corresponding env/*.js (jni-env-patching ③ "supply a reasonable value")
4. Re-run

Until there are no more TypeErrors in stderr.

**Expected output**: the bridge finishes without crashing + Node outputs the type=result JSON. But _px3 may still be empty (continue with Steps 7-8).

---

## Step 7: Configure the TLS layer

**Skill used**: `curl_cffi_integrate_scrapy_performance`

Check the session configuration in `px_cookie_generator.py`:

```python
# this line must exist
self.session = curl_requests.Session(impersonate="chrome131")
```

**Key checks**:
- ✅ impersonate uses `chrome131` (aligned with the UA Chrome/131 in env/navigator.js)
- ✅ reuse the same Session (do not create a new session per request — TLS handshake info would change)
- ✅ if the site enforces HTTP/2, confirm curl_cffi is 0.7+ (early versions have poor H2 support)

```python
# verify the TLS fingerprint is correct
python -c "
from curl_cffi import requests
s = requests.Session(impersonate='chrome131')
r = s.get('https://tls.peet.ws/api/all')
import json
d = r.json()
print('JA3:', d['tls']['ja3_hash'])
print('JA4:', d['tls']['ja4'])
print('HTTP/2 settings:', d['http2']['sent_frames'])
"
# expect JA3 to match real Chrome 131
```

**Expected output**: the TLS fingerprint fully impersonates real Chrome 131.

---

## Step 8: Differential comparison + iterate ⭐

**The core link**: it runs without crashing but the _px3 score is low → use differential comparison to find **which field is wrong**.

**Skills used**: `cdp-browser` + `jni-env-patching` ③④

### 8.1 Capture real Chrome's collector POST body

```bash
# launch Chrome + clean session + capture for 30s
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py start
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py navigate "https://www.<site>.com"
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py network 30 > /tmp/<site>_real_chrome_traffic.json

# extract the collector POST body
jq '.[] | select(.request.url | contains("collector")) | .request.postData' \
   /tmp/<site>_real_chrome_traffic.json > /tmp/<site>_real_post.txt
```

### 8.2 Capture our bridge's collector POST body

Modify the `_proxy_request` in `px_cookie_generator.py` to dump the request body to a file:

```python
def _proxy_request(self, msg):
    # add these two lines (debugging)
    with open(f'/tmp/<site>_bridge_post_{msg["id"]}.txt', 'w') as f:
        f.write(msg.get('body') or '')
    # ... original code
```

Run the bridge to get the dump.

### 8.3 diff the EV1 / EV2 fields

```bash
# decode using revers/payload.js (the project already has a decoding tool)
node skill/AI_re/scripts/decode_payload.js /tmp/<site>_real_post.txt > /tmp/<site>_real_decoded.json
node skill/AI_re/scripts/decode_payload.js /tmp/<site>_bridge_post.txt > /tmp/<site>_bridge_decoded.json

# diff
diff <(jq -S . /tmp/<site>_real_decoded.json) <(jq -S . /tmp/<site>_bridge_decoded.json)
```

**Output form**:

```diff
- "field_001": "Win32"
+ "field_001": "MacIntel"
     ↑ navigator.platform is wrong → fix env/navigator.js
- "field_034": "5da3b8e2..."
+ "field_034": "00000000..."
     ↑ canvas hash is wrong → check env/canvas.js + @napi-rs/canvas fonts
- "field_087": "<hash>"
+ "field_087": "<other_hash>"
     ↑ Object.keys(window) hash is wrong → add the missing prop to env/px_intercept.js
```

### 8.4 Fix field by field

For each diff:
1. Use **cdp-browser** to look up the real Chrome value of the corresponding API
2. Paste the real value into env/*.js
3. Re-run → re-diff
4. The fields diff fewer and fewer until EV1/EV2 match completely

**Expected output**: the bridge runs and obtains a non-empty _px3 (e.g. `len > 500`).

---

## Step 9: Validate + write the journal

### 9.1 End-to-end business API call works

Reference the template in `stample/live_validation/journal/2026-05-21.md`:

```bash
# 1. obtain _px3 (done in Step 8)
# 2. use this _px3 to call the real <site> business API
python -c "
from px_cookie_generator import PXCookieGenerator
gen = PXCookieGenerator(verbose=True, proxy='$HTTPS_PROXY')
px3 = gen.generate()
# use _px3 to call the business API
import curl_cffi.requests as r
resp = r.get('https://<site>/v1/api/...', cookies={'_px<n>': px3}, ...)
print('Business API:', resp.status_code, resp.text[:200])
"
```

Expect HTTP 200 + real business data.

### 9.2 Write the journal

Copy the `stample/live_validation/journal/2026-05-21.md` template and rename it to `<YYYY-MM-DD>.md`:

```markdown
# YYYY-MM-DD <site> Node Bridge Field Record

## Dual-site test conclusion
- <site>: _px<n> via bridge + business API HTTP 200 ✓

## Part 1 · <site>
### 1.1 API introduction (...)
### 1.2 Risk-control architecture (...)
### 1.3 IP requirements (...)
### 1.4 Working code → node_bridge/<site>/
### 1.5 Live request + response (full HTTP)
### 1.6 PX research insights (the new things discovered this time)

## Pitfall list
- ...
```

### 9.3 Write this site's README

Add to `node_bridge/<site>/README.md`:

```markdown
# Node Bridge — <site>

## SDK version
SHA: <sha256>
Locked date: YYYY-MM-DD

## Working commands
\`\`\`bash
npm install
export HTTPS_PROXY='http://<user>:<pwd>@<host>:<port>'   # <region> residential
python px_cookie_generator.py
\`\`\`

## Expected output
\`\`\`
✅ _px<n> SUCCESS! len=...
   first 80: ...
   _pxvid: ...
\`\`\`

## Differences from the ifood template
- AppID: ...
- Collector: ...
- Cookie: ...
- env/navigator.js changes: ...

## journal
- First working run: stample/live_validation/journal/YYYY-MM-DD.md
```

**Expected output**: a complete `node_bridge/<site>/README.md` + journal entry.

---

## Completion checklist

- [ ] Step 1: SDK locked + SHA recorded
- [ ] Step 2: 4 constants identified
- [ ] Step 3: template copied successfully
- [ ] Step 4: 3-file constants changed correctly
- [ ] Step 5: 5 real Chrome dump groups pasted into env/
- [ ] Step 6: bridge does not crash, obtains type=result JSON
- [ ] Step 7: TLS uses chrome131
- [ ] Step 8: EV1/EV2 diff fields all match
- [ ] Step 9: business API 200 + journal written

---

## What to do when it does not work

Judge using the decision tree in [`methodology.md §7 When to upgrade to sdenv`](methodology.md#7-when-to-upgrade-to-sdenv):

- **The error is a V8-level detection such as `typeof document.all`, `Function.prototype.toString`, or `Error().stack`** → upgrade to sdenv
- **It is simply a missing API / wrong value** → keep iterating using the 4 techniques in §2

---

*Tutorial v1.0 · written based on iFood field practice · 2026-05-22*
