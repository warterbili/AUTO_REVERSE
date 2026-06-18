# Case Study: DailyPay (Android) × Castle.io Anti-Bot Token Reverse Engineering

> Target app: `com.DailyPay.DailyPay` v48.0.0 ｜ Target SDK: Castle.io `io.castle.android` **v3.1.1** (engine codename Highwind)
> Result: **Fully reverse-engineered + locally byte-level end-to-end verified** the `X-Castle-Request-Token` generation algorithm, producing a working generator.
> See the reusable capability in the skill: [`skills/web/castle-reverse`](../../skills/web/castle-reverse/SKILL.md)

## One-sentence conclusion
DailyPay's Castle token = **hex-assembled device fingerprint + 3 layers of nibble XOR (time layer slice4/rot3, uuid layer slice8/rot9, random-byte layer) + base64url**, with **no block cipher whatsoever (XXTEA has been removed)**. It belongs to the same family as the open-source `castleio-gen` (web v2.6.0 / token v11) but has already drifted; the **open-source decoder fails on this target**, so it had to be re-reversed — this case study completes that re-reversing and byte-level verification.

## Process following the auto_reverse 7-phase method

**Phase 0 Intake**: Neither the device nor disk had the APK → used the newly created `apk-acquire` skill to automatically download the v48.0.0 XAPK (base + 3 splits) from APKPure, and installed it to a real device with `adb install-multiple`.

**Phase 1 Fingerprint**: RN + Hermes + Expo application; the DEX contains `io.castle.android` (39 occurrences) + `createRequestToken` + `X-Castle-Request-Token`; also ThreatMetrix (secondary, out of scope). The token is in native Java, not in .so/JS → follow the standard jadx Java chain. See `fingerprint.json` for details.

**Phase 3 Static**: jadx decompile → entry chain `createRequestToken() → Highwind.token() → u.g()`; the engine `io.castle.highwind.android` has 70 obfuscated classes. Recovered the primitives one by one (`q/d0/y/p0/z/b0/c/k`), confirming **no XXTEA/AES/Cipher**; `f.a()` (the main fingerprint) failed in jadx → completed it with `--show-bad-code` + runtime hooks. See `static-findings.json` and the skill's `references/algorithm-v3.1.1-android.md` for details.

**Phase 4 Dynamic**: frida hooked `createRequestToken/u.g()/f.a()/d.c()` and captured the **real token + plaintext fingerprint** — within the fingerprint hex, `Xiaomi/zh-CN/Android/DailyPay/48.0.0/full UA/Asia/Shanghai` are all plaintext, **dynamically confirming that SBA has no encryption**. Then hooked the `z` constructor to enumerate all 24 fields at runtime (idx, value, type). See `dynamic-findings.json` for details.

**Phase 6/7 Synthesize + Verify**: Implemented the complete generator `gen_v311.py` + decoder `decode_v311.py`, with all three **byte-level verifications passing**:
- Building all 24 fingerprint fields from scratch using the raw device values == the real device's `f.a()` output (byte for byte);
- Rebuilding the **real token from the fingerprint + per-step random quantities == the captured token** (byte for byte);
- A freshly generated token round-trips consistently through decoding (pk `pk_`+35 / version 3.1.1 / cuid / timestamp).
See `report.md` for the full report.

## Key differences from open-source material (the core value of this case)
The open-source material covers web v11; this target is v3.1.1, and the measured reality is: **XXTEA removed (both whole-token and per-field)**, **SBA fields are plaintext UTF-8**, **the behavioral fingerprint was switched to device motion sensors**, the pk has its prefix removed and is embedded inline, and the container layout was rearranged. The open-source `DecodeToken` expects `0x0b` + xxtea, but the real token is `0x0a` + no xxtea → failure. See the skill's `references/opensource-vs-v311.md` for details.

## Boundary: why "server-acceptance-level E2E" was not completed
When attempting to send the self-generated token to the DailyPay backend for acceptance, the signup endpoint `POST employees-api.dailypay.com/v2/signup_users` returned **403**. Systematic investigation (real US residential IP / TLS fingerprint spoofing / Castle token / device fingerprint / UA / app headers all disproved one by one) confirmed: **this is a CloudFront Lambda@Edge policy/eligibility gate, unrelated to Castle** (the genuine app on a real device also gets 403; the empty `referral:{}` points to employer eligibility). So server-level acceptance is blocked by a business barrier that sits before Castle, and the highest locally achievable standard (byte-level reproduction) has been completed. See `signup-403-diagnosis.md` for details.

## Project gaps exposed and already fixed
- **`apk-acquire` skill** (new): auto_reverse's original Phase 0 had no "automatic APK acquisition" capability; this case filled it in (adb pull → local → APKPure direct link + verification + optional install).

## Deliverables manifest
| File | Description |
|---|---|
| `report.md` | Comprehensive report (algorithm + full f.a() table + verification results) |
| `signup-403-diagnosis.md` | Root cause of the signup 403 (not Castle, CloudFront edge gate) |
| `fingerprint.json` / `static-findings.json` / `dynamic-findings.json` | Per-phase deliverables |
| skill `castle-reverse`: `tools/gen_v311.py`, `tools/decode_v311.py`, `scripts/hook_*.js`, `source-castleio-gen/`, `references/*` | Reusable capability |

## Reproduce
```bash
# Generator self-check (byte-level verification)
python skills/web/castle-reverse/tools/gen_v311.py verify
# Decode a real token
python skills/web/castle-reverse/tools/decode_v311.py <token_file>
```
