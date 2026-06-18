# Castle.io `X-Castle-Request-Token` Reverse Engineering Report — DailyPay (Android)

> Target: the Castle.io anti-bot / device-fingerprint SDK that DailyPay v48.0.0 depends on.
> Conclusion: **fully reverse-engineered and end-to-end verified** the token generation algorithm of the
> Castle Android SDK **v3.1.1** (codename Highwind). This version belongs to the same algorithm family as the
> public open-source material (yubie-re/castleio-gen, v2.6.0/token v11), but **a key drift has occurred** —
> this report takes real-device measurements as authoritative.

## 1. Target and positioning

| Item | Value |
|---|---|
| App | `com.DailyPay.DailyPay` v48.0.0 (RN+Hermes+Expo) |
| Anti-bot SDK | **Castle.io**, native Java `io.castle.android` **v3.1.1** (`BuildConfig.VERSION_NAME`) |
| Engine | `io.castle.highwind.android` ("Highwind", 70 obfuscated classes, pure Java, no .so) |
| Entry | `Castle.createRequestToken()` → `Highwind.token()` → `u.g()` |
| Request header | `X-Castle-Request-Token` (valid for 120s, one per request) |
| pk | starts with `pk_`, length 35; recovered from the token in practice (redacted `pk_qVBR…6v`) |
| Secondary fingerprint | ThreatMetrix (`libTMXProfiling-rl-8.0-82-jni.so`) — independent, out of scope here |

## 2. Token algorithm (v3.1.1, layer by layer)

The whole token is assembled in the **hexadecimal-string domain** (each byte = 2 hex chars), then finally `unhex`'d back into bytes and base64url encoded.

```
time      = unixSeconds - 1535000000                      # same constant as open source
nibble    = hex(rand(0..15))                               # time-layer XOR key (1 nibble)
randByte  = rand(0..255)                                   # final-layer XOR key

# ① fingerprint data segment fpHex
fpMain    = f.a()                  # main device fingerprint (plaintext fields, see §3)
partHdr   = (fpMain.size & 31) | 64
bPart     = r.a()                  # secondary fingerprint segment (idx=a()=6)
motion    = d.c()                  # motion sensors (accel/gyro/magnetic/rotation/gravity/user-accel)
fpHex     = partHdr + fpMain.data + ((bPart.size&31)|((6&7)<<5)) + bPart.data + motion + "ff"

# ② time material string2 (6 bytes)
string2   = xor_and_append(BE4(time), nibble) + xor_and_append(BE2(last 3 digits of time%1000), nibble)

# ③ three layers of XOR
strA4     = deriveKeyXor(key=string2, slice=4, rot=string2[3], data=fpHex)   # time layer
uuidLayer = deriveKeyXor(key=uuidHex, slice=8, rot=uuidHex[9], data=string2+strA4)  # uuid layer
str4      = "0a" + hex(pk[3:]) + version(2B) + uuidHex(16B) + uuidLayer

# ④ final layer + wrapping
token     = base64url( unhex( hex(randByte) + xorHex(str4 + hex(len(str4Hex)&0xff), hex(randByte)) ) )
```

Core primitives (DEX → semantics, each cross-checked against open source):

| Highwind | Semantics | Open-source equivalent |
|---|---|---|
| `y.a(int)` | byte→2hex; `y.c()` hex→byte | `bytes.hex` / `unhexlify` |
| `q.a.a(int)` | time→4 BE bytes, clamp `0x0FFFFFFF` | `encode_timestamp_to_bytes` |
| `q.a.a(hex,key)` | nibble XOR (key cycles) | `xor_hex_strings` |
| `q.a.a(ver,i)` | version bit packing `(patch&63)|(i<<13)|((major-1)&3)<<11|((minor&31)<<6)` | inverse of `decode_version_bytes` |
| `d0.a.a(hex,key)` | XOR and append key | `xor_and_append_key` |
| `d0.a.a(key,slice,rot,data)` | take first slice, rotate by hex(rot), XOR | `derive_key_and_xor_bytes` |
| `p0.a.a(str,255)` | UTF-8 encode (≤255B), **no encryption** | (open source uses xxtea here) |
| `z.a()` / `b0.a()` | field header `((idx&31)<<3)|(type&7)` + encoding | `process_fp_value` |
| `k.a.a(b)` | Base64 flag 11 (url-safe, no padding) | `urlsafe_b64encode().rstrip("=")` |

Field type enum (same as open source): `1=UNK 3=B2H 4=SBA 5=B2H_WITH_CHECKS 6=B2H_ROUNDED 7=JUST_APPEND`.

## 3. Main fingerprint `f.a()` fields (measured on real device, plaintext)

The hooked 183-byte `f.a()` output is **entirely plaintext**, containing:
`Xiaomi` (manufacturer), `zh-CN` (locale ×2), `Android`, `cn`, `DailyPay`, `48.0.0`,
the full UA `DailyPay/48.0.0 (510250072) (Castle 3.1.1; Android 13; Xiaomi MI 9)`,
`Asia/Shanghai` (time zone), interleaved with B2H fields such as platform enum / screen / memory / time-zone offset, terminated by `0xff`.

## 4. Differences from open-source material (the core conclusion here)

The public material (yubie-re/castleio-gen, yubie.dev, antibot.blog) covers **Castle v2.6.0 / token v11 (Web/JS)**,
and the author explicitly does not support v2.6.2+/V12. DailyPay uses **v3.1.1**, with the following measured differences:

| Dimension | Open source v2.6.0 (v11) | DailyPay v3.1.1 (measured) |
|---|---|---|
| Whole-token block cipher | **XXTEA**(TEA_KEY) wrapping + `0x0b` version byte + padding | **no XXTEA**; str4 goes straight into the final-layer XOR, first byte `0x0a` |
| SBA field (type4) | each field xxtea(key=[idx,init_time,…]) | **plaintext UTF-8** (`p0.a.a`) |
| pk location | full pk in the header | `str4` contains `pk.substring(3)` (drops `pk_`) |
| Behavioral fingerprint | mouse/touch/keyboard event datapoints | **device motion sensors** (acceleration/gyroscope/magnetometer/rotation/gravity/linear acceleration) |
| Container layer | timestamp/version/pk/uuid + xxtea | `0x0a`+pk body+version+uuid+uuidLayer, with the timestamp merged into the uuid layer |

**Empirical proof**: the open-source `DecodeToken` expects the post-XOR first byte `0x0b`, but the real token gives `0x0a`, and its xxtea step has no counterpart →
the open-source decoder produces garbage on v3.1.1. → **the open-source algorithm is the correct "family", but it is outdated for v3.1.1 and must be re-reversed** (which is exactly what this report does).

## 5. Verification (gold standard, Phase 7)

`tools/decode_v311.py` (in-house, no xxtea) against the real token:
- length-byte check **OK**; first byte `0x0a` ✓
- recovered the **pk** (`pk_`+32, len 35) ✓, **version 3.1.1** (== BuildConfig) ✓, **cuid**, **timestamp** ✓
- after stripping the 3 XOR layers, **the independently hooked `f.a()` fingerprint (183B) appears verbatim in the decode result** (right after the `0x58` part header) → full-chain confirmation ✓
- two tokens: pk/cuid/version constant, only time/random change → determinism confirmed ✓

## 6. Complete generator (implemented + byte-level verified)

`tools/gen_v311.py` — builds a valid `X-Castle-Request-Token` from raw device fields, fully in-house.

**Full `f.a()` 24-field table** (reverse-engineered from the `f.a()` smali, cross-checked at runtime via z-hook):

| idx | Source | type | idx | Source | type |
|---|---|---|---|---|---|
| 0 | `g.b()&4` feature bits | 4 | 15 | app name | 5 |
| 1 | Build.MANUFACTURER | 5 | 17 | app versionName | 5 |
| 2 | locale(`q0`) | 5 | 18 | battery level% | 6 |
| 3 | /proc/meminfo memory GB | 7 | 19 | battery charging state&3 | 4 |
| 4 | screen width/height ÷ density | 8 | 24 | **User-Agent** | 8 |
| 5 | /proc/cpuinfo core count | 6 | 25 | deviceIdSource | 4 |
| 6 | `e.f` | 6 | 26 | time-zone ID | 5 |
| 7 | density | 7 | 27 | `g.e()` locale | 5 |
| 8 | `g.b` | 8 | 31 | device boot timestamp | 8 |
| 9 | Build.MODEL | 5 | (20/21/22) | motion sensors *conditional* | 7 |
| 10 | `e.c()` | 8 | (23/28) | location *conditional* | 5/8 |
| 11 | Build.VERSION.RELEASE | 5 | | | |
| 12 | "Android" | 5 | | | |
| 13 | carrier name | 5 | | | |
| 14 | country ISO | 5 | | | |

r.a() 14 fields: minutes since boot, memory KB, screen orientation, battery temperature/voltage/technology/health, brightness, whether it is an emulator, ABI, JVM version, etc.
Field-type mapping `c.a(i)=i-1` (internal 1..8 → wire 0..7); normalization is in `z.<init>`.

**Byte-level end-to-end verification (`gen_v311.py verify`, all ✅):**
- **Test A fingerprint encoder**: building the 24-field fp_main from raw values (with the UA computed live) → **byte-for-byte identical** to the real device's `f.a()` output.
- **Test B token assembler**: from the fingerprint + per-step random quantities, the **real captured token was rebuilt byte for byte successfully**.
- **Fresh generation**: generated a brand-new token using the current time and decoded it back to pk / version 3.1.1 / fingerprint with a **byte-level consistent round-trip**.

The only thing not done: sending a purely synthetic token to the Castle backend for acceptance (it is the other party's server + the pk is redacted, so not performed);
the highest locally achievable standard (byte-for-byte reproduction of the real token) has passed.

## 6b. Reproduction path

- Decoder: `tools/decode_v311.py <token_file> [fp_hex_file]`
- **Generator: `tools/gen_v311.py` (the `verify` subcommand runs all byte-level verifications)**
- hooks: `scripts/hook_castle.js` (capture token), `scripts/hook_capture_one.js` (single full-capture record)

## 7. Reproduction scripts / deliverables manifest

| File | Description |
|---|---|
| `tools/decode_v311.py` | v3.1.1 token decoder + verifier (in-house, field-tested) |
| `scripts/hook_castle.js` | frida hook: createRequestToken / u.g / f.a / d.c |
| `workspace/03-static/dex7-src/sources/io/castle/highwind/android/` | decompiled Highwind engine source |
| `workspace/04-dynamic/captured_tokens.txt` `fp_data_main.hex` | real-device captured samples (redacted context) |
| `docs/source-castleio-gen/` | open-source v2.6.0 re-implementation (comparison baseline) |

## 8. To-do (before porting into auto_reverse)

- Enumerate the semantics of all 24 `f.a()` fields (completing from captured plaintext hex + smali), and write the complete v3.1.1 **generator**.
- Collect non-zero motion samples with the device in motion, to confirm the float encoding.
- Organize this case + the `castle-reverse` skill + the `apk-acquire` skill gaps together into `cases/` and `skills/`.
