---
name: castle-reverse
description: Castle.io (io.castle.android / "Highwind" engine, and the web castle.browser.js) anti-bot reversing — recover how the X-Castle-Request-Token + __cuid (x-castle-client-id) are generated, and reproduce them with an offline generator. Covers the Android native-Java SDK (v3.1.1, fully reversed: hex-assembled device fingerprint + 3-layer nibble-XOR + base64url, NO XXTEA) and the web/JS SDK (v2.6.0 / token v11, via the archived open-source reimpl). Use when a target sends X-Castle-Request-Token / x-castle-client-id, loads castle.browser(.min).js, calls Castle.createRequestToken(), or depends on io.castle.android. Trigger terms: Castle.io, X-Castle-Request-Token, x-castle-client-id, __cuid, io.castle.android, Highwind, castle.browser.js, createRequestToken.
---

# Castle.io Reverse-Engineering Skill

Castle.io is a device-fingerprint / anti-bot SDK. The client SDK emits a per-request
header **`X-Castle-Request-Token`** (+ a stable **`x-castle-client-id` / `__cuid`**),
which the protected backend forwards to Castle's Risk API for scoring.

Two SDK families, same token container, **different fingerprint payload + crypto**:

| | Web / JS | Android (native Java) |
|---|---|---|
| SDK | `castle.browser(.min).js` | `io.castle.android` + engine `io.castle.highwind.android` ("Highwind") |
| version reversed | **v2.6.0 / token v11** (open-source) | **v3.1.1** (this skill, fully reversed) |
| fingerprint | browser (canvas/webgl/fonts/navigator + mouse/touch events) | device (sensors/screen/cpu/mem/battery/carrier/UA) |
| crypto | **XXTEA** (whole-token + per-field SBA) + multi-XOR + base64url | **NO XXTEA** — 3-layer nibble-XOR + base64url only |

## When to trigger

A target (app or site) sends `X-Castle-Request-Token`, loads `castle.browser*.js`,
calls `Castle.createRequestToken()`, or bundles `io.castle.android`. You need to
read, decode, or reproduce the token.

## Assets

- `tools/gen_v311.py` — **full Android v3.1.1 token generator** (device fields → token). `python gen_v311.py verify` runs the byte-exact self-tests.
- `tools/decode_v311.py` — Android v3.1.1 token **decoder** (recovers pk / version / cuid / timestamp / fingerprint; peels the 3 XOR layers).
- `source-castleio-gen/` — archived open-source **web v11** reimpl (yubie-re/castleio-gen): `GenerateToken/DecodeToken/TEA(xxtea)/CastleEncoding/CastleFP*`. Reference baseline + the web algorithm.
- `scripts/hook_castle.js` — frida: hook `Castle.createRequestToken` / `u.g()` / `f.a()` / `d.c()` to capture a real token + intermediate fingerprint.
- `scripts/hook_capture_one.js` — frida: dump ONE complete `u.g()` call (pk/uuid/fp_main/b_part/motion/token) as JSON for byte-exact verification.
- `scripts/hook_flow_all.js` — frida: log every OkHttp request + which carry the Castle header + status (find the allowlisted endpoints).
- `references/algorithm-v3.1.1-android.md` — the full reversed Android algorithm (entry chain, primitives, token layout, 24-field f.a() + 14-field r.a() maps).
- `references/opensource-vs-v311.md` — web-v11 vs android-v3.1.1 diff (what carried over, what changed).

## Workflow (Android)

1. **Locate**: jadx the APK → `io.castle.android.Castle.createRequestToken()` → `Highwind.token()` → `u.g()`; the engine is `io.castle.highwind.android` (obfuscated single-letter classes). Read `references/algorithm-v3.1.1-android.md`.
2. **Capture**: frida `scripts/hook_castle.js` (token + fp) and `hook_capture_one.js` (one full call as JSON).
3. **Decode**: `decode_v311.py <token_file>` → recovers pk / version / cuid / fp. (The open-source web decoder will FAIL on v3.1.1 — it expects XXTEA.)
4. **Generate**: `gen_v311.py` builds a token from device fields; `verify` proves it reproduces a real token byte-for-byte and round-trips through the decoder.
5. **Version-drift check**: confirm `io.castle.android.BuildConfig.VERSION_NAME`. If ≠ 3.1.1, re-diff `u.g()` and the `f.a()` field list — Castle changes the fingerprint fields and occasionally the container across versions (this is exactly why the open-source v11 reverse is outdated).

## Workflow (Web)

`castle.browser.js` calls `Castle.createRequestToken()` in JS. Use `cdp-browser` to
capture the token + hook the SDK; the algorithm (token v11) is in `source-castleio-gen/`.
For a clean, accepted token, Castle's web SDK reads **browser fingerprints + behavior**,
so an anti-detect browser (`nodriver` / `cdp-browser`) + residential IP + human-like
behavior is the practical path — or generate the token directly from the v11 algorithm
with a coherent fingerprint.

## Gotchas (learned on the DailyPay case — see cases/dailypay-castleio-android)

- **v3.1.1 dropped XXTEA entirely.** SBA fields are plaintext UTF-8; the whole-token TEA wrap is gone. The open-source `DecodeToken` will mis-parse a v3.1.1 token at the xxtea step (post-XOR leading byte is `0x0a`, not v11's `0x0b`).
- **Android replaces web mouse/touch datapoints with real device motion sensors** (`d.c()`: accel/gyro/magnetic/rotation/gravity/user-accel). Stationary device → zeros.
- **The token is assembled as a HEX STRING** (each byte = 2 hex chars), `y.c()` = hex→bytes at the very end, then base64url flag 11 (URL_SAFE|NO_PAD|NO_WRAP).
- **pk is `pk_`+32 chars (len 35)**, embedded as `pk.substring(3)` inside the token — you can recover it by decoding.
- **The header is allowlist-gated** (`Castle.isUrlAllowlisted` / `baseURLAllowList`): the token only attaches to specific backend URLs, which often fire only after login. Use `hook_flow_all.js` to find them.
- **Token validity ~120s**; regenerate per request.
- **The token being accepted server-side also depends on non-Castle gates** (CDN/edge IP & policy filters, business eligibility) that sit *in front of* Castle — don't attribute a request rejection to Castle without capturing the response (the DailyPay case's signup 403 was a CloudFront Lambda@Edge gate, not Castle).
