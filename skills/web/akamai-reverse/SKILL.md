---
name: akamai-reverse
description: Akamai Bot Manager (BMP / Bot Manager Premier) reverse-engineering skill — an end-to-end methodology from traffic-capture fingerprinting to generating server-accepted sensor_data / akamai-bm-telemetry and obtaining a valid _abck cookie. Covers the roles of the four cookie types _abck / bm_sz / ak_bmsc / sbsd, the sensor_data POST handshake (N requests; `-1-` invalid state vs `~0~` valid state detection), the two diverging routes Web sensor_data and mobile BMP (pipe -1,2,-94 protocol + RSA/AES/HMAC + PoW), the sensor field structure (-100 system info / -115 verify stats / -117 touch / -143 motion, etc.) and generator parameterization (app package name / lang / version / device fingerprint), as well as the reality of Akamai script version drift (pin script version; sensor format changes across versions). The mobile path routes directly to xvertile/akamai-bmp-generator as a usable starting point; the Web path provides methodology (requires per-target work). Trigger terms: Akamai, Akamai Bot Manager, BMP, sensor_data, akamai-bm-telemetry, _abck, bm_sz, ak_bmsc, sbsd, bm-verify, x-acf-sensor-data, /_bm/, akam, "bypass akamai", "akamai anti-scraping", "_abck invalid".
languages: [en]
---

# Akamai Bot Manager Reverse-Engineering Skill

> **TL;DR**: Akamai anti-scraping has two layers — (1) the HTTPS transport layer with TLS/JA3/JA4 + HTTP2 fingerprinting; (2) the application-layer behavioral risk control = the client collects device/browser/behavior signals → encrypts them into **sensor_data** → POSTs them to the Akamai edge → receives a valid **_abck** cookie in return.
> This skill provides **collection + routing + methodology**: first fingerprint to classify the target, then for mobile route directly to the existing full reverse-engineered implementation `xvertile/akamai-bmp-generator`; for Web provide a px-reverse-style per-target methodology.
>
> An honest disclaimer up front: **there is no single "universal generator" for Akamai Web sensor_data**. The script changes per site and per version, the canvas fingerprint cannot be randomly faked, the behavioral trajectory must be realistic enough, and on top of that there are TLS fingerprinting + IP reputation. **This is per-target work.** Mobile BMP only has an existing full implementation because its protocol is relatively stable and device fingerprints can be pooled.

---

## When to trigger (fingerprinting)

If any of the following match, it is Akamai Bot Manager — use this skill:

**Cookie fingerprints** (most reliable):
- `_abck` — the core verification cookie, the return value of the sensor_data POST. Looks like `<token>~-1~-1~...` or `...~0~...`
- `bm_sz` — Bot Manager session, issued by the Akamai edge on the first page load, used as one of the inputs to sensor generation
- `ak_bmsc` — Akamai Bot Manager session cookie (edge-side session state)
- `bm_sv` / `bm_mi` / `bm_lso` — auxiliary session cookies
- `sbsd` / `sbsd_o` — a **newer** Akamai enhanced verification type (introduced after Akamai upgraded to v3; already supported in the xiaoweigege repo), a secondary handshake independent of sensor_data

**Request fingerprints**:
- The POST body is a big base64 blob with `$` separators (Web), or the pipe protocol `-1,2,-94,...` (mobile BMP)
- `akamai-bm-telemetry`, `x-acf-sensor-data`, or `X-Akamai-BMP` appears in the request headers / body
- The collection script URL contains an obfuscated path, commonly `/_bm/`, `...akam...`, or a randomized script name (different per site)
- When blocked it returns **403** (not 412/429), and the response again sets `Set-Cookie: _abck=...~-1~-1~...`

**Counterexamples when classifying** (do NOT use this skill): `_px3/_px2`→PerimeterX (use px-reverse); `datadome` cookie→DataDome; `__cf_bm/cf_clearance`→Cloudflare; `X-Castle-Request-Token`→Castle (use castle-reverse).

---

## ⚠️ The first step is always the fork: Web sensor_data vs mobile BMP

This is where beginners go wrong most often — **the two routes have completely different protocols and completely different tools**:

| Dimension | **Web sensor_data** | **Mobile BMP (Bot Manager Premier mobile SDK)** |
|---|---|---|
| Client | Browser JS (obfuscated collection script) | Android/iOS app with the embedded Akamai BMP SDK |
| Payload name | `sensor_data` / `akamai-bm-telemetry` (header, base64) | `sensor_data` (pipe protocol string) |
| Key signals | **canvas fingerprint**, WebGL, fonts, navigator, **mouse trajectory** | **device Build info**, sensor motion (accelerometer/gyroscope/orientation), touch events |
| Encryption | Custom per version (restore the script via AST) | RSA (public key) wraps the AES key + AES-CBC + HMAC-SHA256 + base64 + optional **PoW** |
| Existing implementation | ❌ None universal; per-target work | ✅ **`xvertile/akamai-bmp-generator`** (Go, full reverse engineering of 2.1.2→4.2.1) |
| Difficulty | canvas cannot be randomly faked + behavioral realism + TLS fingerprint | device fingerprint pool quality + pinning the right version |

**Routing rules**:
- **Target is a mobile app / mobile API** → go straight to `references/bmp-mobile.md` and use `akamai-bmp-generator` as the starting point. This is the only "out-of-the-box" path in this skill.
- **Target is a website** → follow the methodology in `references/web-sensor.md`. First use `cdp-browser` (real Chrome) to capture the sensor POST, and confirm whether you can bypass it directly with browser automation (often this is more cost-effective than pure algorithmic work).

---

## Workflow (numbered steps — do not skip any)

1. **Fingerprint and classify**: first confirm it really is Akamai (see When to trigger above). `GET` the target homepage and check whether the response has `Set-Cookie` for `bm_sz` / `ak_bmsc` and `_abck`. When a business endpoint returns 403, capture the `Set-Cookie: _abck=` in the response — if it ends in `~-1~-1` it is the invalid state, confirming this is sensor risk control rather than a pure IP ban.

2. **Fork**: mobile → step 3 (BMP); Web → step 6 (sensor_data). **Do not start reading the script before classifying.**

3. **[Mobile] First solve the TLS fingerprint**: Akamai's first layer already checks the TLS/HTTP2 fingerprint. In Python use `curl_cffi` (impersonate chrome/safari/okhttp); in Go use `bogdanfinn/tls-client`. **If TLS is wrong, even a perfect sensor gets 403.** This step is independent of the sensor — verify it separately first (with a browser UA + correct TLS, a GET of the homepage that obtains `bm_sz` means it passes).

4. **[Mobile] Run akamai-bmp-generator**: `git clone xvertile/akamai-bmp-generator && cd cmd/akamai-bmp-server && go run main.go`, then POST `/akamai/bmp`:
   ```json
   {"app":"com.target.app","lang":"en_US","version":"3.3.4","challenge":false,"powUrl":"https://m.target.com"}
   ```
   This returns `{"sensor":"...","userAgent":...}`. **The key is that `version` must be pinned to the BMP version the target app actually uses** (see step 5).

5. **[Mobile] Pin the right BMP version**: decompile the app with jadx and search for the `BMPSDK` / `Akamai BMPSDK/` UA string, or frida-hook the sensor generation point to capture the first few fields of the real sensor (the first segment of the pipe string is the version number, e.g. `3.3.4`). Wrong version → the sensor field set / ordering / protocol header does not match → 403. The generator supports 2.1.2 / 2.2.2 / 2.2.3 / 3.1.0 / 3.2.3 / 3.3.0 / 3.3.1 / 3.3.4 / 3.3.9 / 4.0.2 / 4.2.1.

6. **[Web] Try browser automation first**: use `cdp-browser` (real Chrome, no webdriver traces) + a residual fingerprint + a residential IP to access the site directly. Akamai is very lenient toward real Chrome + real behavior. **If a browser can solve it, do not do pure algorithmic reverse engineering of sensor_data** (the cost differs by an order of magnitude).

7. **[Web] Capture the sensor POST + pin the script**: use CDP to intercept the sensor_data POST (find the POST sent to the Akamai edge, whose body is a big base64 blob). At the same time, download the obfuscated collection script and record its sha256 — **Akamai changes script versions frequently, so you must pin the same version and collect several batches of samples**, otherwise the fields will not line up.

8. **[Web] The sensor_data handshake loop (the abck state machine)**: see §_abck handshake below.

9. **[Web] sbsd (if present)**: newer sites require passing the sbsd secondary handshake in addition to sensor_data. First confirm whether the sbsd cookie exists / is required by the business endpoint; if present, you must reverse-engineer its payload separately (refer to the sbsd support in xiaoweigege/akamai2.0-sensor_data).

10. **Stability test**: after obtaining a `~0~`-state `_abck`, request the business endpoint; it only passes if it returns 200 across 5+ consecutive requests, IP changes, and spaced-out requests.

---

## 🔑 The _abck handshake state machine (core; the easiest to get wrong)

sensor_data **is not a one-shot send** — it is a state machine:

```
Initial GET of homepage → Akamai issues _abck=<token>~-1~-1~...   ← invalid state (ends in ~-1~-1)
   │
   ▼ POST sensor_data #1 (with current _abck + bm_sz)
The updated _abck may still be ~-1~-1 (not enough trust)
   │
   ▼ POST sensor_data #2, #3 …
_abck becomes ...~0~...   ← valid state! you can stop
```

**Decision rules** (from hypersolutions / xiaoweigege field experience):
- `_abck` contains `~0~` → **valid, stop POSTing**; you can request the business endpoint.
- `_abck` ends in `~-1~-1` → still invalid, keep POSTing (or the parameters are not realistic enough and are permanently held in the invalid state).
- When a site **does not use the `~0~` indicator**: the rule of thumb is that after a **fixed 3 sensor POSTs** it is considered ready.
- Every POST must carry the **current latest `_abck` + `bm_sz`** (the cookies are updated with each response and must be written back).
- `_abck` has a lifetime; when a business endpoint returns 403 and re-issues `~-1~-1`, you must redo the handshake (usually a single sensor recovers from the "invalidated state").

> ⚠️ Common mistake: many people have all the sensor fields correct yet cannot obtain `~0~`. The cause is usually **(a) sending the next request without writing back the updated `_abck`/`bm_sz`**; **(b) not enough POSTs**; **(c) the sensor is not realistic enough and Akamai "lets it through but slows it down"** (xiaoweigege's original wording: when the parameters are not realistic enough, Akamai will allow the request through but delay it by 10s); **(d) the TLS/IP layer failed first, unrelated to the sensor.**

---

## sensor field structure (high level) + generator parameterization

**Mobile BMP** (pipe protocol, from the akamai-bmp-generator source, using 3.3.4 as the example):

Serialization format: each field is concatenated as `-1,2,-94,<id>,<value>` (`SerializeBmp`). Key field ids:

| id | Meaning | Source |
|---|---|---|
| (first segment) | BMP version number, e.g. `3.3.4` | constant, **must be pinned correctly** |
| `-100` | system info (screen, battery, Build.MODEL/BRAND/FINGERPRINT, androidId, lang…) | device fingerprint + `UrlEncode` |
| `-101` | event listeners `do_en,dm_en,t_en` | constant |
| `-103` | background events | random time series |
| `-112` | performance benchmark `PERF_BENCH` | device fingerprint pool |
| `-115` | **verify stats** (touchVel / motion cumulative value / duration / `FeistelEncode` checksum) | computed, **this segment is the most critical; if wrong it fails outright** |
| `-117` | touch event sequence | randomly generated |
| `-143` | motion data (accelerometer/gyroscope, DCT transform + `BmpHash` encoding) | randomly generated |
| `-150` | `1,0` | constant |

Encryption chain (`EncryptSensor`): `AES key (16B random) → RSA-PKCS1v15 public-key encryption → b64`; `sensor string → AES-128-CBC (random IV) → iv+ciphertext → HMAC-SHA256 → all b64`; final form `<encrypted>$<powResponse>$<powToken>`.

**Parameterization entry points** (the generator's `AkamaiRequest`):
- `app` — the app package name (e.g. `com.ihg.apps.android`), goes into the `-100` field, **must be the target's real package name**
- `lang` — e.g. `en_US`, goes into `-100`
- `version` — the BMP version, **must be pinned to the target**
- `challenge` + `powUrl` — whether to do Proof-of-Work (only needed when the site has PoW enabled; it will GET `<domain>/_bm/get_params?type=sdk-pow` to obtain nonce/difficulty and solve the SHA-256 PoW)
- device — drawn randomly from the `devices.json` device pool (2K real device fingerprints); **the pool's quality directly determines the pass rate**

**Web sensor_data** structure at a high level: xiaoweigege's analysis of maersk.com found it to be a **58-element array** concatenated and encrypted, in which the **canvas fingerprint + mouse movement trajectory are the most critical**, and the canvas cannot be randomly faked (you must collect a real browser's). The `akamai-bm-telemetry` header = a base64 variant of sensor_data. **It changes per version and relies on AST-based restoration of the obfuscated script**; there is no existing universal implementation.

---

## Gotchas (real pitfalls)

1. **The TLS fingerprint is the first wall, independent of the sensor.** A raw send with `requests`/`httpx` is guaranteed to get 403. You must use `curl_cffi` (impersonate) / `tls-client` (Go) / a real browser. Verify TLS passes separately before touching the sensor.
2. **`bm_sz` / `_abck` must be written back.** Every response may update these two cookies, and the next request must carry the latest values. Use a persistent session (curl_cffi Session / cookiejar).
3. **Pinning the wrong BMP version = mismatched field set = 403.** Use jadx/frida first to confirm the target app's real BMP version number, then choose the generator's `version`.
4. **The device fingerprint pool quality determines everything** (mobile). Using the stock `devices.json` may get flagged quickly; for high concurrency you need to expand the real device pool + one fingerprint per device + rotate IPs.
5. **The canvas cannot be randomly faked** (Web). You must collect a real browser's canvas fingerprint to substitute in; motion/mouse trajectories must be algorithmically simulated to look human.
6. **The "let through but slow down" trap.** When the sensor is not realistic enough, Akamai does not return 403 directly but instead lets it through while dragging the response out to 10s — it looks like it passed but the confidence is actually very low. Monitor response latency; don't look only at the status code.
7. **Script version drift** (Web). Akamai updates the collection script frequently, and old AST-restoration results stop working. **Pin the sha256, collect several batches of samples from the same version**, and bind the restored artifacts to the version number.
8. **sbsd is an independent secondary handshake.** New sites may still block you with sbsd even after sensor_data passes. First confirm whether sbsd is mandatorily required by the business endpoint, then decide whether to reverse it separately.
9. **IP reputation is a hidden dimension.** A data-center IP may be suppressed even with a perfect sensor; only a residential IP reliably obtains `~0~`. A 403 is not necessarily your sensor's fault — use a trust matrix (real browser / your script × clean / dirty IP) first to pinpoint which layer is the wall.
10. **PoW is only needed when the site enables it** (`challenge:true`). Blindly enabling PoW adds an extra `/_bm/get_params` request and needlessly increases your exposure surface; first confirm whether the target actually requires PoW.
11. **`akamai-bmp-generator` is a starting point, not an endpoint.** It provides a protocol-correct sensor skeleton; the specific site's device pool, version, PoW switch, TLS, and IP still need you to tune them to the target. Be honest that "this is per-target work."

---

## Example (the shortest usable mobile path)

```bash
# 1. Start the generator
git clone https://github.com/xvertile/akamai-bmp-generator
cd akamai-bmp-generator/cmd/akamai-bmp-server && go run main.go    # :1337

# 2. Generate the sensor (version must be pinned to the target app)
curl -s -XPOST localhost:1337/akamai/bmp -d \
  '{"app":"com.ihg.apps.android","lang":"en_US","version":"3.3.4","challenge":false}'
# → {"sensor":"...$...$","userAgent":"...","model":"SM-A326U",...}
```

```python
# 3. Use correct TLS + abck handshake (Python side)
from curl_cffi import requests
s = requests.Session(impersonate="chrome")            # key: TLS fingerprint
s.get("https://m.target.com/")                         # get bm_sz / initial _abck

for i in range(3):                                     # abck state machine
    sensor = gen_sensor()                              # call the generator
    r = s.post("https://m.target.com/akam/...",        # sensor submission endpoint
               data=sensor, headers={"User-Agent": UA})
    abck = s.cookies.get("_abck", "")
    if "~0~" in abck:                                  # valid state, stop
        break

# 4. Request the business endpoint with the valid cookie
print(s.get("https://m.target.com/api/...").status_code)   # expect 200
```

> There is no equivalent "shortest path" for the Web side. Follow `references/web-sensor.md`: prefer `cdp-browser` browser automation; pure algorithmic reverse engineering is per-target hard work (AST-restore the script + a real canvas pool + behavioral simulation).

---

## Companion references

| File | Contents |
|---|---|
| [`references/bmp-mobile.md`](references/bmp-mobile.md) | The full mobile BMP protocol: pipe field table + encryption chain + PoW + akamai-bmp-generator usage + version pinning method |
| [`references/web-sensor.md`](references/web-sensor.md) | Web sensor_data methodology: cookie state machine details + browser-automation-first strategy + AST restoration route + sbsd + an honest difficulty assessment |

Related skills: on mobile, pair with `jadx-reverse-engineering` (pin the version) + `frida-hooking` (capture the real sensor); on Web, pair with `cdp-browser` (capture/automation) + `node-bridge-build` (run the obfuscated script).

---

## ❌ "Natural-language traps" to avoid

1. **"Find a universal Akamai bypass"** — it does not exist for the Web side. Per site / per version.
2. **"Sending the sensor once is enough"** — wrong, it is a state machine; watch for `~0~` or a fixed 3 times.
3. **"Status code 200 means it passed"** — wrong; beware the "let through but slow down" case, and check the latency and whether the business data is real.
4. **"Just add a UA to requests"** — wrong, the TLS fingerprint fails first.
5. **"Randomly generate the canvas"** — wrong, the canvas cannot be faked; it must be collected for real.
6. **"A 403 must be a sensor error"** — not necessarily; first use a trust matrix to distinguish which layer failed: sensor / TLS / IP.

---

*This skill is compiled from xvertile/akamai-bmp-generator (full mobile reverse engineering, Go) + xiaoweigege/akamai2.0-sensor_data (Web sensor_data/sbsd analysis) + the public Akamai _abck handshake documentation. All protocol fields, the encryption chain, and cookie states come from source code and real testing, not from fabricated memory.*
