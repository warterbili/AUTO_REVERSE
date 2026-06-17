# Web v2.6.0/token-v11 (open-source) vs Android v3.1.1 (this skill)

The open-source `source-castleio-gen/` reverses Castle's **web/JS SDK v2.6.0 (token v11)**.
DailyPay bundles the **Android SDK v3.1.1**. Same token-container *family*, but the crypto
and the fingerprint payload changed. **Verify the version (`BuildConfig.VERSION_NAME`) first**;
Castle drifts across releases (the open-source authors stopped at v11 and refused v12+).

## Carried over (container / transport — reusable)
- epoch constant `1535000000`, clamp `0x0FFFFFFF`
- token assembled as a hex string, byte = 2 hex chars
- `xor_and_append_key` (d0.a 2-arg)
- `derive_key_and_xor_bytes`: fp-data key slice 4 / rot[3]; uuid key slice 8 / rot[9]
- random-byte final XOR (prepended) + base64url no-padding (flag 11)
- field type enum 1/3/4/5/6/7 and header `((idx&31)<<3)|(type&7)`
- B2H_WITH_CHECKS `>127 -> (v&0x7fff)|0x8000`; B2H_ROUNDED `*10`
- version bit-packing (major-1 / minor / patch)
- `0xFF` fingerprint terminator

## Changed in v3.1.1 / Android (must re-reverse)
| | web v11 | android v3.1.1 |
|---|---|---|
| whole-token cipher | **XXTEA**(TEA_KEY) + `0x0b` version byte + padding | **none** — str4 goes straight to the random-byte XOR; leading byte `0x0a` |
| SBA fields (type 4/5) | xxtea-encrypted (key=[idx,init_time,...]) | **plaintext UTF-8** (`p0.a.a`) |
| behavioral fingerprint | mouse/touch/keyboard event datapoints + custom-float encoding | **device motion sensors** (accel/gyro/magnetic/rotation/gravity/user-accel) |
| pk placement | full pk in header | `pk.substring(3)` (drop `pk_`) inside str4 |
| container head | timestamp + version + pk + uuid (+ xxtea) | `0x0a` + pk-body + version + uuid + uuidLayer; send-time lives inside the uuid layer |
| id source | — | can use Widevine DRM id (`Highwind.ID_SOURCE_WIDEVINE`) |

## Practical consequence
- The open-source `DecodeToken.py` **fails on a v3.1.1 token**: it expects the post-XOR
  leading byte to be `0x0b` (v11) and then runs `xxtea_decrypt(TEA_KEY)`; a v3.1.1 token
  has `0x0a` and no XXTEA, so it produces garbage. Use `tools/decode_v311.py` instead.
- The container/XOR scheme is reusable; the **crypto layer and fingerprint payload are not**.
- Empirically confirmed by hooking `f.a()` on a real device: the fingerprint is plaintext
  (manufacturer/locale/UA/timezone all readable in the hex) — direct proof XXTEA is gone.
