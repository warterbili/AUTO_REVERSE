# Node Bridge Environment-Patching Methodology

> This document is aimed at an **AI agent automatically building a node_bridge**. The core questions it distills:
> **How do you know what to patch? How do you patch it reasonably? How do you troubleshoot when it does not work? When do you give up and upgrade to sdenv?**

> 🔝 **Fallback project**: [**sdenv** — https://github.com/pysunday/sdenv](https://github.com/pysunday/sdenv)
> · 718⭐ · jsdom fork with C++ modifications · paired pure-algorithm project [rs-reverse](https://github.com/pysunday/rs-reverse)
> · For detailed lessons drawn from it see §5 of this document, for the upgrade decision see §7

---

## 0. Three-skill synthesis diagram ⭐

The node bridge **does not grow from scratch** — it is an **organic synthesis** of 3 upstream skills + jsdom + 11 env modules + a Python TLS layer:

```
   ┌─────────────────────────────┐    ┌──────────────────────────────┐
   │   cdp-browser skill         │    │   jni-env-patching skill     │
   │   (upstream — value capture)│    │   (methodology — 4-step)      │
   │                             │    │                              │
   │   - launch real Chrome      │    │   ① identify the crash error  │
   │   - eval arbitrary JS, dump │    │   ② inspect real env (Java/   │
   │     real values             │    │      Chrome)                  │
   │   - capture navigator/screen│    │   ③ supply reasonable values  │
   │   - capture canvas/audio    │    │   ④ when unsure, hook real    │
   │     hash                    │    │      device / real Chrome     │
   │   - capture real collector  │    │                              │
   │     POST packets            │    │                              │
   └──────────┬──────────────────┘    └──────────┬───────────────────┘
              │                                   │
              │   (analogy)                       │
              │   JNI patches Android Java layer  ≡   env/ patches Browser DOM layer
              │                                   │
              ▼                                   ▼
   ┌────────────────────────────────────────────────────────────────┐
   │            node_bridge/<site>/                                  │
   │                                                                  │
   │   ┌────────────────────────────────────────────────────────┐   │
   │   │ Layer 1: env/*.js (11 env-patching modules)             │   │
   │   │  ← hardcoded real values dumped by cdp-browser          │   │
   │   │  ← the mock set iterated out via the jni-env-patching    │   │
   │   │     4-step method                                       │   │
   │   │  ← each module corresponds to one class of fingerprint  │   │
   │   │     API (navigator/canvas/audio/fonts/events/...)       │   │
   │   └────────────────────────────────────────────────────────┘   │
   │                                                                  │
   │   ┌────────────────────────────────────────────────────────┐   │
   │   │ Layer 2: px_node_bridge.js                              │   │
   │   │  ← JSDOM (jsdom@22 npm package) provides window/document│   │
   │   │  ← overrides window.XMLHttpRequest / window.fetch       │   │
   │   │     → intercepts but does not send, outputs JSON to     │   │
   │   │       Python                                            │   │
   │   │  ← handles PX bake|cookie instructions (the do[] array) │   │
   │   └────────────────────────────────────────────────────────┘   │
   │                                                                  │
   │   ┌────────────────────────────────────────────────────────┐   │
   │   │ Layer 3: px_cookie_generator.py                         │◀──┐
   │   │  ← Python main process, spawns the Node bridge          │   │
   │   │  ← curl_cffi(impersonate='chrome131') actually sends    │   │
   │   │     the requests                                        │   │
   │   │  ← stdio IPC: receives Node output / writes Node input  │   │
   │   │  ← parses the final _px3 cookie                         │   │
   │   └────────────────────────────────────────────────────────┘   │
   └────────────────────────────────────────────────────────────────┘
                                                                       │
                                  ┌────────────────────────────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────────────┐
                  │   curl_cffi_integrate skill (network)  │
                  │                                        │
                  │   - full chrome131 TLS impersonation   │
                  │   - HTTP/2 SETTINGS frames / WINDOW_   │
                  │     UPDATE                             │
                  │   - automatic JA3 / JA4 fingerprint    │
                  │     matching                           │
                  │   - automatically reuses Chrome's      │
                  │     cipher order                       │
                  └───────────────────────────────────────┘
```

## 0.x Three-skill contribution mapping

| Concern | Providing skill | Role in the bridge | Where it lands |
|---|---|---|---|
| How to know the real Chrome values | **cdp-browser** | One-time dump of real Chrome JS values | The **source** of the hardcoded data in `env/*.js` |
| How to decide what to patch + how to change it | **jni-env-patching** | Iterative methodology (the 4-step method) | How `env/*.js` grows from blank into 11 files |
| How to keep PX from detecting the TLS | **curl_cffi_integrate** | Network-layer TLS impersonation | `px_cookie_generator.py` uses chrome131 |
| How to build the fake browser world | **this skill + jsdom** | DOM container + 11 env + IPC interception | `px_node_bridge.js + env/*.js` |
| How to dump fingerprint hashes | **cdp-browser** | Capture the real canvas/audio/font hashes | `env/canvas.js` + `env/audio.js` |

---

## 1. Core principle (borrowed from jni-env-patching)

**"Inspect the real environment first, then supply reasonable values. No blind environment patching."**

The analogy:

| Dimension | JNI env patching (Android) | **Browser env patching (this skill)** |
|---|---|---|
| Platform | unidbg + Android SO | Node + jsdom |
| Missing piece | JNI callback to the Java layer | Browser API (navigator/canvas/audio) |
| Error form | `UnsupportedOperationException` | `TypeError: ... is not a function` |
| Resolution | `AbstractJni` override callback | `env/*.js` override of window properties |
| Inspecting the real env | JADX / apktool smali reading the Java layer | DevTools / **cdp-browser** reading real Chrome |
| When unsure | Frida hook on a real device | **cdp-browser** dump of real Chrome |

**Things you must not do**:
- Supply random values (e.g. `screen.width = 1234`) → only meaningful if it matches real Chrome
- Copy mock values from other projects online → those may target a different vendor, and PX will not accept them
- Try to mock every browser API → impossible (the DOM has 1000+ APIs)

---

## 2. The 4 discovery techniques (how to find out what to patch) ⭐⭐

### Technique 1: Static grep (coarse SDK filtering)

```bash
# beautify SDK
npx js-beautify perimeterx/<sdk>.js > /tmp/sdk_pretty.js
wc -l /tmp/sdk_pretty.js   # usually 10000+ lines

# grep for known fingerprint API calls
grep -n "navigator\.userAgent" /tmp/sdk_pretty.js
grep -n "Object\.keys(window)" /tmp/sdk_pretty.js
grep -n "canvas\.toDataURL\|getContext('2d')" /tmp/sdk_pretty.js
grep -n "new AudioContext\|new OfflineAudioContext" /tmp/sdk_pretty.js
grep -n "navigator\.plugins\|navigator\.mimeTypes" /tmp/sdk_pretty.js
grep -n "screen\.width\|screen\.colorDepth" /tmp/sdk_pretty.js
grep -n "performance\.memory\|performance\.now" /tmp/sdk_pretty.js
grep -n "WebGLRenderingContext\|getSupportedExtensions" /tmp/sdk_pretty.js
```

Each grep hit points to a wrapper function name (minified ones look like `xS()`, `hQ()` — 2-3 characters).

**Output**: a list of suspected wrapper functions (10-20 of them).

### Technique 2: Dynamic breakpoints (real Chrome + DevTools)

```bash
# launch real Chrome via the cdp-browser skill
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py start
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py navigate "https://<target_site>"

# DevTools Console:
debug(xS)      // set a breakpoint on the SDK's xS function
debug(mh)      // set a breakpoint on the SDK's mh function

# reload the page → the SDK breaks when it reaches these functions
# inspect the call stack / arguments / internal logic
```

**Output**: a clear understanding of what each wrapper does (fingerprint collection / hash / serialization).

### Technique 3: Differential comparison ⭐ (most efficient)

**Core idea**: run the SDK in two environments simultaneously and diff the EV2 POST body:

```python
# A. capture the collector POST body from real Chrome
import subprocess
real_post = subprocess.check_output(['python', cdp_script, 'network', '15'])
# extract the payload field of the collector POST

# B. capture the POST body from JSDOM (with no env mock)
node_post = run_bridge_no_mocks()  # output from our bridge

# decode + diff the EV2 fields
diff_ev2(real_post, node_post)
# output looks like:
#   field_001: 'Win32' vs 'MacIntel'         → navigator.platform mismatch
#   field_034: '5da3b8...' vs '00000000...'   → canvas hash mismatch
#   field_087: hash_A vs hash_B               → Object.keys(window) mismatch
```

**Output**: knowing exactly which fields are wrong → directly corresponds to which API to patch. This is the **most economical** technique, used on every iteration.

### Technique 4: Proxy interception (god-tier trick)

Wrap navigator/document/window in a Proxy to **record which properties the SDK actually reads**:

```javascript
// add in env/builder.js (during debugging)
window.navigator = new Proxy(window.navigator, {
    get(target, prop) {
        console.log(`[PX-READ] navigator.${String(prop)}`);
        return target[prop];
    }
});
window.screen = new Proxy(window.screen, {
    get(target, prop) {
        console.log(`[PX-READ] screen.${String(prop)}`);
        return target[prop];
    }
});

// run the SDK → in the console, see which properties PX actually read
//   [PX-READ] navigator.userAgent
//   [PX-READ] navigator.userAgentData      ← jsdom does not have this
//   [PX-READ] navigator.connection         ← jsdom does not have this
//   [PX-READ] navigator.hardwareConcurrency
//   ... (50+ properties)
//   [PX-READ] screen.width
//   [PX-READ] screen.colorDepth
```

**Output**: a complete list of the APIs that must be mocked.

**Note**: a Proxy cannot be installed on an already-frozen object (some jsdom prototypes are frozen). When it fails, fall back to adding a getter with `Object.defineProperty`.

---

## 3. cdp-browser skill detailed dump templates (paste-and-use)

The standard command set for dumping real Chrome, whose output is **pasted directly into env/*.js**:

### 3.1 Full navigator dump

```bash
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py navigate "https://www.<site>.com"

python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py eval "
  JSON.stringify({
    userAgent: navigator.userAgent,
    appVersion: navigator.appVersion,
    platform: navigator.platform,
    vendor: navigator.vendor,
    vendorSub: navigator.vendorSub,
    productSub: navigator.productSub,
    language: navigator.language,
    languages: [...navigator.languages],
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    doNotTrack: navigator.doNotTrack,
    webdriver: navigator.webdriver,
    pdfViewerEnabled: navigator.pdfViewerEnabled,
    plugins: [...navigator.plugins].map(p => ({
      name: p.name, filename: p.filename, description: p.description,
      mimeTypes: [...p].map(m => ({ type: m.type, suffixes: m.suffixes, description: m.description }))
    })),
    userAgentData: navigator.userAgentData ? {
      platform: navigator.userAgentData.platform,
      mobile: navigator.userAgentData.mobile,
      brands: navigator.userAgentData.brands
    } : null,
    connection: navigator.connection ? {
      effectiveType: navigator.connection.effectiveType,
      downlink: navigator.connection.downlink,
      rtt: navigator.connection.rtt,
      saveData: navigator.connection.saveData
    } : null,
  })
"
```

### 3.2 screen / window / visualViewport

```bash
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py eval "
  JSON.stringify({
    screen: {
      width: screen.width, height: screen.height,
      availWidth: screen.availWidth, availHeight: screen.availHeight,
      colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
      orientation: screen.orientation ? { type: screen.orientation.type } : null
    },
    window: {
      innerWidth: innerWidth, innerHeight: innerHeight,
      outerWidth: outerWidth, outerHeight: outerHeight,
      devicePixelRatio: devicePixelRatio
    },
    visualViewport: visualViewport ? {
      width: visualViewport.width, height: visualViewport.height,
      offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop,
      pageLeft: visualViewport.pageLeft, pageTop: visualViewport.pageTop,
      scale: visualViewport.scale
    } : null
  })
"
```

### 3.3 window enumerable keys (critical — PX uses Object.keys(window) to compute a hash)

```bash
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py eval "
  Object.keys(window).filter(k => !k.startsWith('_')).sort()
"
# outputs an array of ~250 keys
# diff against jsdom Object.keys(window) → the difference is what px_intercept.js must patch
```

### 3.4 Canvas fingerprint hash calibration (for env/canvas.js)

```bash
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py eval "
  const c = document.createElement('canvas');
  c.width = 200; c.height = 50;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = \"14px 'Arial'\";
  ctx.fillStyle = '#f60';
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.fillText('BrowserLeaks,com <canvas> 1.0', 2, 15);
  c.toDataURL().slice(-50)
"
# real Chrome output: '...some-base64-tail-50-chars'
# our bridge runs the same code with @napi-rs/canvas → output should match
# if it does not match → the @napi-rs/canvas version / font configuration is wrong
```

### 3.5 Collector POST body capture (for differential comparison)

```bash
# launch Chrome + network capture + trigger the PX SDK run
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py navigate "https://www.<site>.com"
python ~/projects/Sourcing-AI-Skills/cdp-browser/scripts/cdp.py network 30 > /tmp/real_chrome_traffic.json

# extract the collector POST request bodies
jq '.[] | select(.request.url | contains("collector"))' /tmp/real_chrome_traffic.json
```

---

## 4. Concrete application of the jni-env-patching 4-step method in this skill

| jni-env-patching step | Node bridge equivalent | Implementation |
|---|---|---|
| ① Identify the crash error | Read the TypeError in `[NODE]` stderr | `TypeError: Cannot read property 'X' of undefined` → X is missing |
| ② Read the semantics in the Java layer | Use **cdp-browser** to dump the corresponding real Chrome property | `cdp eval "JSON.stringify(navigator.X)"` |
| ③ Supply a random but reasonable value | Hardcode the dumped real Chrome value into `env/<file>.js` | Do not randomize — match real Chrome exactly |
| ④ When unsure, hook a real device | Set a DevTools breakpoint on the SDK wrapper function and inspect the real value | `debug(xS)` + breakpoint |

Fully isomorphic — the platform and host differ, but the methodology maps 1:1.

---

## 5. The 4 lessons borrowed from sdenv ⭐

sdenv (https://github.com/pysunday/sdenv, 718⭐) is the public ceiling for environment-patching frameworks. Worth borrowing from:

### 5.1 ⭐ Fixing jsdom's root problems at the C++ layer

sdenv maintains `sdenv-jsdom` (a fork of jsdom) that modifies the C++ source to fix some **detections that can never be bypassed at the JS layer**:

```javascript
// the HTML5 spec mandates that document.all must be truthy but typeof === 'undefined'
typeof document.all === 'undefined' && document.all   // real browser: true

// real Chrome:   typeof = 'undefined', value = HTMLAllCollection (truthy)
// standard jsdom: typeof = 'object',    value = HTMLAllCollection   ← detected instantly
// sdenv-jsdom:   modifies the C++ binding so typeof returns 'undefined' while staying truthy
```

**Our node_bridge does not do this** — JS-layer mocks cannot override `typeof` behavior (that is dictated by the V8/C++ layer).

**When to upgrade to sdenv**: when you hit V8-level detection of `typeof document.all` or `Function.prototype.toString` (see §7).

### 5.2 Plugin-ized env (not hardcoded per single site)

sdenv's directory structure:

```
sdenv/
├── sdenv-jsdom         ← generic low-level fork
└── sdenv-extend/
    ├── plugins/
    │   ├── ruishu/     ← Ruishu-specific patches
    │   ├── akamai/     ← Akamai-specific
    │   └── generic/    ← generic (UA / screen / canvas)
```

One plugin per site, with the generic part shared. By comparison ours:

```
node_bridge/ifood/px-node-env/env/     ← iFood + PX mixed, not split apart
```

**Lesson**: refactor into a plugin form (consider this when adapting to a new site):
```
node_bridge/
├── env-core/         ← Chrome generic
├── plugins/
│   ├── px/           ← PX-specific
│   ├── akamai/       ← Akamai-specific
│   └── ifood/        ← iFood-specific
```

### 5.3 Proxy-wrapped window for dev logging

sdenv has engineered "Technique 4" (Proxy interception):

```javascript
// sdenv usage
const env = createSdenv({
    window: {
        proxy: {
            logger: 'all',          // log all reads and writes
            errorOnUnknown: false   // do not throw when reading undefined properties
        }
    }
});
// → run the SDK → the console streams all window/document accesses
```

**Lesson**: add an optional `DEBUG_PROXY=1` switch to our env/builder.js that enables Proxy interception on all navigator/window/document.

### 5.4 Dual-track architecture (bridge + pure algorithm)

sdenv pairs with [rs-reverse](https://github.com/pysunday/rs-reverse) (Ruishu pure algorithm) — **two repos**.
Our project = `node_bridge/` + `revers/` **within a single repo**.

Neither is inherently better; the **architecture is isomorphic**.

---

## 6. Why PX does not work with happy-dom / linkedom (pitfall avoidance)

Many people ask, "Isn't happy-dom faster than jsdom?" **For the PX anti-bot scenario**, none of them work:

| Alternative | Speed | Reason it cannot be used |
|---|---|---|
| **happy-dom** | 2-3x faster than jsdom | Missing `MutationObserver` / `IntersectionObserver` / `PerformanceObserver` / `requestIdleCallback` and other APIs the PX SDK requires. **PX crashes on the very first line of init code.** |
| **linkedom** | Extremely fast (no JS engine) | **Cannot run JS** — it only parses HTML. The PX SDK is 10000 lines of JS, which linkedom simply cannot load. |
| **deno_dom** | Rust implementation | The Deno ecosystem is standalone; curl_cffi / node packages cannot be used. The Python coordinator cannot connect to it. |

**Conclusion**: jsdom is currently the only viable base. For something tougher, go to sdenv (a jsdom fork). For something tougher still, go to real Chrome (puppeteer/playwright stealth).

---

## 7. When to upgrade to sdenv ⭐

**Upgrade decision tree**:

```
Working? ─→ leave it alone (keep using our bridge)
   │
   ▼ not working
   │
look at stderr / SDK errors / response body characteristics:
   │
   ├── HTML px-captcha + extremely low score → add more env mocks, see §2.3 differential comparison
   │
   ├── HTML "challenge-platform / Cloudflare" → add a BR/US residential proxy + a UA consistent with the IP region
   │
   ├── SDK calls `typeof document.all` and it returns 'object' → ⭐ upgrade to sdenv
   │
   ├── SDK calls `Function.prototype.toString` to detect the native-code marker → ⭐ upgrade to sdenv
   │
   ├── SDK uses `new Proxy(window, ...)` to detect at the V8 engine layer → ⭐ upgrade to sdenv
   │
   ├── SDK checks `Error().stack` and the call stack contains 'jsdom' → ⭐ upgrade to sdenv or rename the stack
   │
   └── score is high enough but the cookie keeps getting rejected by the server → network-layer / TLS / IP-score issue (calibrate curl_cffi chrome131)
```

### sdenv integration quick guide

```bash
# 1. install sdenv
npm install sdenv-jsdom sdenv-extend

# 2. replace the top of px_node_bridge.js
# original:
const { JSDOM } = require('jsdom');
# change to:
const { JSDOM } = require('sdenv-jsdom');   // jsdom fork, interface-compatible

# 3. key stubs are provided by sdenv-extend:
const { applyPxPatches } = require('sdenv-extend');
applyPxPatches(window);   // this abstracts away the work of px_intercept.js
```

**Note**: the patches that ship with sdenv-extend mainly target the **Ruishu VMP**; PX-specific ones still have to be written yourself as a plugin. But the underlying jsdom fork already solves the spec-quirk class of problems for you.

### When not to upgrade

| Scenario | Do not upgrade, keep using our bridge |
|---|---|
| Working + score high enough | Do not gild the lily |
| iFood / Grubhub PX, medium difficulty | Our bridge is already sufficient |
| Unwilling to introduce a new jsdom fork dependency | Maintaining two jsdom variants adds complexity |

---

## 8. Pitfall quick reference (from real-world practice)

| Symptom | Cause | Fix |
|---|---|---|
| `npm install canvas` fails (MSBuild error) | Windows lacks MSBuild | `npm install canvas@3` (has a Windows prebuild) |
| SDK stuck at `/ns`, does not send subsequent POSTs | Node's default TLS != Chrome, PX detects and aborts | Must use Python curl_cffi chrome131; you **cannot** run generate_px.js standalone directly |
| Bridge 30s timeout is not enough to get _px3 | The SDK flow has 4 collector POSTs; a slow link times out | Increase the `px_node_bridge.js` setTimeout to 60s |
| Python reports `[Errno 22] Invalid argument` | The Node bridge has already exited while Python is still writing stdin | px_cookie_generator.py already has BrokenPipeError tolerance |
| A single curl request times out (15s) | Slow proxy link + default timeout too short | `timeout=30` |
| Homepage access returns 403 | Not using the corresponding regional proxy (BR for iFood, US for Grubhub) | Set HTTPS_PROXY to a residential proxy in the correct region |
| Proxy interception reports "Cannot redefine property" | jsdom froze certain properties | Fall back to adding a getter with `Object.defineProperty` |
| canvas hash does not match real Chrome | `@napi-rs/canvas` is missing font configuration | Load the dejavu / liberation font sets |
| `Object.keys(window)` hash is wrong | Missing props such as visualViewport / cookieStore / scheduler | Patch them all into `env/px_intercept.js` |

---

## 9. Effort estimates (reference)

| Scenario | Effort | Type of work |
|---|---|---|
| Get the ifood/ template working (verify the environment) | 30 min | DevOps |
| **Update an existing ifood SDK version (same SDK, upgraded)** | 10 min | Change paths + replace files |
| **Copy the ifood template to a new site (same PX vendor)** | 4-8 h | Change 5 constants + calibrate 1-2 env files |
| **Adapt to a new anti-bot vendor (e.g. Ruishu)** | 1-3 days + consider upgrading to sdenv | Write a new plugin |
| **First-time reverse engineering of a new anti-bot vendor + writing a bridge** | 1-2 weeks | High — comparable to the sdenv author's original effort |

---

## 10. What well-written env/ looks like (see ifood/)

Each env/*.js file should:

1. **Top comment** stating "what is being patched + why"
2. **Export an install function** (`installXxx(window)`), called by builder.js
3. **Print `[XX] installed`** so the load order is visible in stderr
4. **Use hardcoded values dumped from real Chrome**, not random ones
5. **Support a `DEBUG=1` env var** to enable Proxy interception (5.3, borrowed from sdenv)

Reference: `node_bridge/ifood/px-node-env/env/navigator.js` is the most standard implementation.

---

*Methodology v1.0 · 2026-05-22 · verified working against iFood _px3 in the field*
