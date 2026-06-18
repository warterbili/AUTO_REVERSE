# Mobile Akamai BMP Protocol Reference (Bot Manager Premier mobile SDK)

> Compiled from the `xvertile/akamai-bmp-generator` source (Go, full reverse engineering). This is the only out-of-the-box path in this skill.
> The protocol field names / ordering / encryption chain all come from `bm/<version>/bm.go` + `sdk/sdk.go`, not from memory.

## 1. Why mobile has an existing implementation and Web does not

- Mobile BMP is a native/Java SDK embedded in the app, and its protocol (pipe serialization + a fixed encryption chain) is relatively stable across versions.
- The device fingerprint is Android `Build.*` static fields + synthesizable motion/touch, which **can be pooled** (2K real devices is enough).
- The Web collection script is customized per site + changed frequently + the canvas cannot be faked + it relies heavily on real behavior, so it cannot be turned into a universal library.

## 2. Pipe serialization protocol

`SerializeBmp(pairs)`: each field that has an id is emitted as `-1,2,-94,<id>,<value>`, while fields without an id emit the value directly, concatenated.

The field assembly order for 3.3.4 (`GenerateSensorData`):

| id | Meaning | Generation method |
|---|---|---|
| first segment (no id) | `BMPVERSION`, e.g. `3.3.4` | constant, **pin to the target** |
| `-90` | challenge info (only when `challenge:true`) | `cf-sdk-1-00-0.js#model=...#sdkVersion=...` |
| `-70`/`-80`/`-121` | empty | `""` |
| `-100` | **system info** | see §3 |
| `-101` | event listeners | constant `do_en,dm_en,t_en` |
| `-102` | eact | usually empty |
| `-103` | background events | `GetBackgroundEvents`: random `action,ts;` sequence |
| `-104` | constant | `-2,3,-50,-301,null` |
| `-108` | text change | empty |
| `-112` | **performance benchmark** | `PERF_BENCH` (device pool field, e.g. `17,906,59,...`) |
| `-115` | **verify stats** | see §4, the most critical |
| `-117` | touch events | `GenerateTouchEvents`: `action,time,0,0,1,1,1,-1;` |
| `-120` | empty | |
| `-142`/`-144`/`-160` | orientation data | commented out by default in 3.3.4, may be empty |
| `-143`/`-145`/`-161` | **motion data** | `GenerateMotionString`: accelerometer/gyroscope |
| `-150` | constant | `1,0` |

The field set differs slightly between versions (this is exactly why the version must be pinned correctly).

## 3. The `-100` system info field (source of the device fingerprint)

`GetSystemInfo` concatenates using `UrlEncode` (note this is Akamai's custom UrlEncode: uppercase hex, preserving some ASCII):
screen height/width, battery, orientation, `lang`, `Build.VERSION.RELEASE`, `MODEL`, `BOOTLOADER`, `HARDWARE`, `app` (package name), androidId, SDK_INT, `MANUFACTURER`, `PRODUCT`, `TAGS`, `TYPE`, `USER`, `DISPLAY`, `BOARD`, `BRAND`, `DEVICE`, `FINGERPRINT`, `HOST`, `ID` …
At the end it appends `Ab(systemInfo)` (an ASCII<128 sum checksum) + a random int + `startTime/2`.

device structure (`dm/device.go`): `SCREEN`, `PERF_BENCH[]`, `BUILD{MANUFACTURER,HARDWARE,MODEL,BOOTLOADER,VERSION{RELEASE,CODENAME,INCREMENTAL,SDK_INT},PRODUCT,TAGS,TYPE,USER,DISPLAY,BOARD,BRAND,DEVICE,FINGERPRINT,HOST,ID}}`.
`androidId`: for SDK_INT≥26 use 16 hex (`GenAndroidId`), otherwise a UUID.

## 4. `-115` verify stats (GetVerifyStats; if wrong it fails outright)

```
0,<touchVel>,<d>,<d2>,<longValue>,<time>,0,<touchSteps>,<shifta>,<shiftb>,<r1>,<r2>,0,<FeistelEncode(longValue, touchSteps+shifta+shiftb, time)>,<startTime>
```
- `time = now - startTime`
- `longValue = d2 + touchVel + d` (the motion/touch cumulative value, derived by summing the values from `CreateMotionPair`)
- `r1 = rand(4,16)*1000`, `r2 = rand(15,53)*1000`
- `FeistelEncode`: 16-round Feistel that encodes the statistics into a single checksum integer. **This is the consistency check across motion/touch/time; filling it in randomly will be detected.**

## 5. motion data (-143)

`GenerateMotionString` → `CreateMotionPair`:
- Generates an accelerometer/gyroscope angle sequence (`GenGenericEvents` lerp interpolation + noise)
- `BmpHash`: quantizes the float sequence into characters from 65 (`A`) to `}` (60 buckets), handling `\`/`.` escaping
- `ShortenBmpHash`: run-length compression; `HashF7`: a CRC-like 32-bit table-lookup hash (the `f7912a` table)
- When the length is a power of 2, it takes the DCT transform branch (zeroing values below the `aeA`/`agA` thresholds)
- Outputs the form `2;<low>;<high>;<hashF7>;<shortHash>`, with multiple axes joined by `:`

## 6. Encryption chain (EncryptSensor)

```
aeskey = random 16B
aesKeyEncrypted = base64( RSA-PKCS1v15( aeskey, rsaPubKey ) )
hmacKey = random 16B
hmacKeyEncrypted = base64( RSA-PKCS1v15( hmacKey, rsaPubKey ) )

doFinal, iv = AES-128-CBC( sensorPlain, aeskey )    // PKCS5 padding, random IV
obj = iv || doFinal
mac = HMAC-SHA256( obj, hmacKey )
encryptedData = base64( obj || mac )

final sensor = "1,a,<aesKeyEncrypted>,<hmacKeyEncrypted>$<encryptedData>$1000,1000,1000"
(GenerateSensorData further assembles it into <encrypted>$<powResponse>$<powToken>)
```
`rsaKey` is the Akamai public key hardcoded into each version's `bm.go` (base64 DER).

## 7. Proof-of-Work (only when challenge:true)

`GetPowParams`: GET `http://<domain>/_bm/get_params?type=sdk-pow` → `{nonce,difficulty,checksum,mode}`.
`SolvePow`: brute-force a `format` such that `FindPowAnswer(SHA256(androidId+uptime+nonce+(difficulty+i)+format), difficulty+i)==0`, producing 10 solutions of increasing difficulty.
Assembled as `androidId;uptime;nonce;difficulty;checksum;<answers>;<iterations>;<elapsed>`.
**If the site has no PoW, don't do it** (`challenge:false`; `GetPowResponse` returns empty directly).

## 8. Using the generator

```bash
git clone https://github.com/xvertile/akamai-bmp-generator
cd akamai-bmp-generator/cmd/akamai-bmp-server   # or ./server
go run main.go --host localhost --port 1337 --devicepath db/devices.json
```
POST `/akamai/bmp`:
```json
{"app":"com.target.app","lang":"en_US","version":"3.3.4","challenge":false,"powUrl":"https://m.target.com"}
```
Returns `{"sensor","androidVersion","model","brand","screenSize","userAgent"}`.
Supported versions: 2.1.2 / 2.2.2 / 2.2.3 / 3.1.0 / 3.2.3 / 3.3.0 / 3.3.1 / 3.3.4 / 3.3.9 / 4.0.2 / 4.2.1.

## 9. How to pin the right version (jadx / frida)

- **jadx**: decompile the app and search for the string `Akamai BMPSDK/` (the UA template `Akamai BMPSDK/<version> (Android; ...)`) or class names containing `bmsdk`/`BotManager`. The version number is the BMP version.
- **frida**: hook the return point of sensor generation and dump the sensor string — the first segment of the pipe string is the version number (e.g. `3.3.4`). At the same time, diff the real sensor's field set against the generator output to confirm the protocol matches.
- Wrong version → the field ordering/set/protocol header does not match → 403 even if the encryption is correct.

## 10. Pass-rate engineering (mobile)

- TLS: Go `bogdanfinn/tls-client` (impersonate okhttp/chrome), Python `curl_cffi`.
- Device pool: expand the real `devices.json`, one fingerprint per device, and avoid reusing the same fingerprint under high concurrency.
- IP: residential/mobile IP, and rotate IPs; high concurrency from a single IP will get it blacklisted.
- abck handshake: see the state machine in SKILL.md; write back `_abck`/`bm_sz` each time.
