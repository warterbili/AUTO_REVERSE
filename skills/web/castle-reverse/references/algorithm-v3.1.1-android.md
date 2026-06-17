# Castle.io Android v3.1.1 ("Highwind") — full reversed algorithm

Reversed from `io.castle.highwind.android` (DailyPay v48.0.0, `BuildConfig.VERSION_NAME=3.1.1`).
Pure Java, no .so. **No XXTEA / AES / Cipher anywhere.**

## Entry chain
```
Castle.createRequestToken()  ->  Castle.id()  ->  Highwind.token()  ->  d.g()
  (d extends abstract u; the real builder is u.g())
header sent: X-Castle-Request-Token   (Castle.requestTokenHeaderName)
cuid/client-id: x-castle-client-id (the uuid below, hyphens stripped)
```
`Highwind(ctx, BuildConfig.VERSION_NAME, storage.getDeviceId(), buildUserAgent(), pk, deviceIdSource)`.
pk must be `pk_`+32 chars (length 35). UA = `appName/appVer (build) (Castle 3.1.1; Android <rel>; <mfr> <model>)`.

## Primitives (obfuscated class -> meaning)
| class.method | meaning | open-source (web v11) equivalent |
|---|---|---|
| `y.a(int)` | byte -> 2 hex chars (low 8 bits) | bytes.hex (token built as HEX STRING) |
| `y.a(int,n)` | int -> big-endian n-byte hex | int_to_fixed_size_bytes_be |
| `y.c(hex)` | hex string -> raw bytes | binascii.unhexlify |
| `y.a(String)` | hex-encode each char (latin1) | — |
| `q.a.a(int)` | timestamp -> 4 BE bytes, clamp 0x0FFFFFFF | encode_timestamp_to_bytes |
| `q.a.a(hex,key)` | nibble-wise XOR, key cycled | xor_hex_strings |
| `q.a.a(verStr,i)` | version pack `(patch&63)|(i<<13)|(((major-1)&3)<<11)|((minor&31)<<6)` | decode_version_bytes (inverse) |
| `d0.a.a(hex,key)` | XOR hex[1:] with nibble, append nibble | xor_and_append_key |
| `d0.a.a(key,slice,rotChar,data)` | take key[:slice], rotate by int(rotChar,16)%slice, XOR data | derive_key_and_xor_bytes |
| `p0.a.a(str,255)` | UTF-8 encode (<=255 bytes), **no encryption** | (web: xxtea per SBA field) |
| `z.a()` | field header `y.a(((idx&31)<<3)|((type-1)&7))` | process_fp_value header |
| `b0.a(list,z)` | per-field encoder (switch on type) | process_fp_value |
| `c.a(i)` | type map `i-1` (internal 1..8 -> wire 0..7) | — |
| `k.a.a(bytes)` | Base64 flag 11 = URL_SAFE\|NO_PADDING\|NO_WRAP | urlsafe_b64encode().rstrip("=") |

## Field types (z.<init> normalization, then b0.a switch)
Internal type -> wire = type-1. null -> type 1 (header only). type7 & value>25.5 -> type6(round).
- 1/2/3 (wire 0/1/2): header only
- 4 (wire 3): header + `y.a(int)` (1 byte)
- 5 (wire 4): SBA = header + `y.a(len)` + utf8(value)   ← **plaintext**
- 6 (wire 5): B2H_WITH_CHECKS: `>127 ? y.a((v&0x7fff)|0x8000,2) : y.a(v)`
- 7 (wire 6): B2H_ROUNDED: `y.a(round(d*10))`
- 8 (wire 7): JUST_APPEND: header + value (value already hex)

## Token layout (u.g)
```
time     = unixSeconds - 1535000000
nibble   = hex(rand(0..15))             ; randByte = rand(0..255)
fpMain   = f.a()  -> a0(data,size=24)   ; partHdr = y.a((size&31)|64)  = 0x58
bPart    = r.a()  -> a0(data,size=14)   ; bHdr    = y.a((size&31)|((a()&7)<<5)) = 0xce  (a()=6)
motion   = d.c()                        ; this.c  = y.a(255) = "ff"  (terminator)
str (e()==2 branch) = partHdr + fpMain + bHdr + bPart + motion + "ff"
string2  = xorAppend(q.a.a(time),nibble) + xorAppend(y.a(last3(time),2),nibble)   # 6 bytes
strA4    = d0.a.a(string2, 4, string2[3], str)                 # time-key layer
uuidLayer= d0.a.a(uuid,    8, uuid[9],   string2 + strA4)      # uuid-key layer
str4     = "0a" + y.a(pk[3:]) + version(2B) + uuid(16B) + uuidLayer
token    = base64url( y.c( y.a(randByte) + q.a.a(str4 + y.a(len(str4)), y.a(randByte)) ) )
```

## f.a() — main fingerprint, 24 fields (idx : source : type)
```
0  g.b()&4 (feature bits)            :4      15 app label (e.g. DailyPay)       :5
1  Build.MANUFACTURER                :5      17 app versionName                 :5
2  locale q0(Locale.getDefault())    :5      18 battery level/scale*100         :6
3  /proc/meminfo MemTotal -> GB      :7      19 battery status enum & 3         :4
4  screen w/density, h/density (2B ea):8     24 User-Agent (this.a of b0)       :8
5  /proc/cpuinfo processor count     :6      25 deviceIdSource (f.d)            :4
6  e.f                               :6      26 g.a (timezone id)               :5
7  displayMetrics.density            :7      27 g.e(ctx) (locale)               :5
8  g.b                               :8      31 boot time (now-elapsedRealtime) :8
9  Build.MODEL                       :5      (20/21/22) motion sensors *cond*   :7
10 e.c()                             :8      (23/28)    location lat/long *cond*:5/8
11 Build.VERSION.RELEASE             :5
12 "Android"                         :5
13 carrier (getNetworkOperatorName)  :5
14 country iso (if phoneType==1)     :5
```
Conditional fields (20-23,28) only appear if sensor/location permission granted; a
stationary no-permission device yields exactly the 24 fields above.

## r.a() — secondary fingerprint, 14 fields
```
0 uptime minutes (elapsedRealtime/60000)   8 battery health enum
1 sensor pair .second/1e6 (or null)         9 c.a() (?)
2 sensor pair .first/1e6  (or null)        10 screen_brightness (Settings.System)
3 /proc/meminfo KB                         11 isEmulator d.c()  (bool)
4 orientation (1/4/0)                       12 d.a()
5 battery temperature /10                   13 System.getProperty("java.vm.version")
6 battery voltage                           14 d.c(ctx) (bool)
7 battery technology (e.g. "Li-poly")       15 d.b(ctx) (bool) ; 16 d.d(ctx) (bool) ; 17 d.a(ctx)
```

## Decode (recover from a real token) — see tools/decode_v311.py
b64url-decode -> randByte=raw[0]; body=xor(raw[1:],randByte)=str4+lenByte;
str4[0]=0x0a, [1:33]=pk body, [33:35]=version, [35:51]=uuid, [51:]=uuidLayer;
peel uuidLayer with (uuid,8,uuid[9]) -> string2(12)+strA4; peel strA4 with (string2,4,string2[3]) -> fpHex.
