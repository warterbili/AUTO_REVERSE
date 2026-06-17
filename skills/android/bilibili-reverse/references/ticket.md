# Bilibili `x-bili-ticket` (GenWebTicket / GetTicket) — Reverse-Engineering

`x-bili-ticket` is a server-issued **JWT** sent as a request header on Bilibili Android API calls. It
is obtained/refreshed by an HMAC-SHA256-signed request to the Ticket service. This document covers
the JWT, the endpoint, the HMAC signing, the lifecycle, the native chain, and the methodology.

---

## 1. What it is

- **Header name:** `x-bili-ticket`
- **Format:** standard JWT (`Base64(header).Base64(payload).Base64(signature)`), `alg: HS256`.
  JWTs start with `eyJ` (the header `{"` Base64-encodes to `eyJ`) — useful as a hook filter.
- **Payload:** `{ exp, iat, buvid }`. The server's signing key id appears as `kid` (e.g. `s03`) on
  the JWT itself — distinct from the request `key_id`.
- **Lifetime:** server-driven. The response declares `ttl` (observed up to 3 days), but the JWT's
  real `exp - iat` is ≈ 8 hours. Refresh based on the response, not on a hardcoded value.
- **Origin:** server-issued (not locally generated) — `iat` is always recent.

---

## 2. Endpoint

The same logical ticket has two transports:

**App (gRPC) — what the app actually uses**
- Service / method: `bilibili.api.ticket.v1.Ticket/GetTicket`
- Request / response types: `GetTicketRequest` / `GetTicketResponse`
- Client class: `TicketMoss.executeGetTicket(request)` — Protobuf over gRPC

**REST (equivalent, simpler — what the Python reimplementation uses)**
```
POST https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket
```
- Params are in the **URL query string**.
- No `access_key` auth — HMAC signature only.
- Only a `User-Agent` header is required (a bare request → HTTP 412).

---

## 3. HMAC signing

Inside `libbili.so`, the request `key_id` is looked up in an obfuscated table (`FUN_001a6a80`) and
resolves to the real HMAC key. The mapping (public):

| key_id | HMAC key | Context |
|--------|----------|---------|
| `ec01` | `Ezlc3tgtl` | Android |
| `ec02` | `XgwSnGZ1p` | Web |

**REST variant (string-based — what `scripts/bili_ticket.py` implements):**

```
hexsign = HMAC-SHA256(key="Ezlc3tgtl", message="ts" + timestamp)   # 64-char lowercase hex
```

Request params (REST):

| Param | Value |
|-------|-------|
| `key_id` | `ec01` |
| `hexsign` | the 64-hex HMAC above |
| `context[ts]` | the Unix timestamp (seconds) — the same `ts` used in the HMAC message |

**App gRPC variant (binary):** same HMAC-SHA256 + same key, but the message is
`protobuf_device_info_bytes + serialize(context_map)` (not the simple `"ts"+ts` string), and the
output is raw 32 bytes wrapped via `ByteString.copyFrom` into the protobuf `sign` field. The gRPC
request also carries `context["x-fingerprint"]` (device fingerprint) and `context["x-exbadbasket"]`
(native risk-control blob).

---

## 4. Response

`GetTicketResponse` / GenWebTicket response:

```json
{ "code": 0, "data": { "ticket": "eyJ...", "created_at": 1700000000, "ttl": 259200 } }
```

- `ticket` — the JWT (the `x-bili-ticket` value)
- `created_at` — issue time
- `ttl` — declared time-to-live (seconds); used to compute the cached expiry

`scripts/bili_ticket.py` treats the ticket as expired `margin` seconds early (default 300) and
refreshes proactively.

---

## 5. Lifecycle (app internals)

- Ticket + expiry are cached in an **in-memory** Java object (`xw2.b{ticket, expiry}`), managed by a
  singleton (`xw2.a`) guarded by a `ReentrantReadWriteLock`. **Not** in SharedPreferences or MMKV.
- On each outbound request, `BiliTickets.onTicketReq(host, path)` returns the cached ticket; if
  expired it triggers an **async** refresh (`vw2.b.e()` → `yw2.a.c()` retry ×4 →
  `TicketMoss.executeGetTicket(...)`).
- Server force-refresh: a response with header `ticketStatus == "1"` →
  `BiliTickets.onTicketResp(...)` → `vw2.b.j()` triggers refresh.

### Native signing — `LibBili.st`

- Java: `static native byte[] st(byte[], SortedMap, String)` (a `byte[]`+`Map` wrapper exists too).
  The first arg is a **`byte[]`** of protobuf-encoded device info (`buvid`, `platform`, `mobi_app`,
  `channel`, `brand`, `model`, `os_ver`, `app_ver`, fingerprint) — these device fields are personal;
  treat captured values as `<BUVID>`, `<FINGERPRINT>`, etc.
- Located at `libbili.so` `+0x9230` (`FUN_00109230` OLLVM shell → `FUN_001a5474` core).
- `FUN_001a5474`: serialize the SortedMap (`FUN_001a606c`) → concat `protobuf + mapBytes` → key
  lookup (`FUN_001a6a80`: `ec01` → `Ezlc3tgtl`) → HMAC (`FUN_001a6bc8`) → 32-byte `byte[]`.
- `FUN_001a6bc8` is a standard 4-step HMAC-SHA256: Init → ipad/opad → Update → Final (32-byte out).

---

## 6. Methodology

1. **SharedPreferences hook (failed):** hooked `getString`/`putString` filtering `eyJ` — no output;
   the ticket isn't stored in SP. MMKV search also empty.
2. **Class-name search (breakthrough):** `enumerateLoadedClasses` filtered on `"ticket"` →
   `com.bilibili.lib.ticket.api.BiliTickets`.
3. **Method hook:** hook `onTicketReq(host, path)` → print the live JWT.
4. **jadx:** trace facade `BiliTickets` → `vw2.b` → `yw2.a` → `zw2.a` → reveals the gRPC call and
   `LibBili.st(..., "ec01")`.
5. **Native:** reuse the RegisterNatives hook to capture native offsets; **manually invoke
   `LibBili.st()`** and observe which offset fires (#10, `+0x9230`) — faster than Ghidra elimination
   since the ticket is cached and `st()` isn't auto-triggered.
6. **Ghidra** for structure; **native hooks** to fill constants — hook the HMAC core
   (`FUN_001a6bc8`, file offset `0xa6bc8`) → confirms `key_len=9`, `key="Ezlc3tgtl"`, 32-byte output;
   hook `FUN_001a6a80` (offset `0xa6a80`) → confirms `ec01` → `Ezlc3tgtl`.

**How the key was found:** static analysis initially mistook `FUN_001a6a80` for
`GetStringUTFChars` (assuming the key was literally `"ec01"`). A native hook on the HMAC core revealed
the real key argument is `Ezlc3tgtl`; a hook on `FUN_001a6a80`'s return value confirmed it's a
key-lookup function (table is datadiv-encrypted).

---

## 7. Gotchas

1. **Hooking `HashMap.put` crashes the app** (called millions/sec) — don't.
2. **Hooking at startup conflicts with `libmsaoaidsec.so`** → `Process terminated`. Delay native
   hooks with `setTimeout(fn, 5000)` (or use the `bypass.js` first).
3. **Ticket is not in SP/MMKV** — it's an in-memory DI object; `BiliTickets` is a pure facade with no
   fields. Use `Java.choose`/reflection.
4. **jadx obfuscated names** (`vw2.b`, `yw2.a`) ≠ runtime names — cross-reference Frida and jadx.
5. **`st()` doesn't auto-trigger** (ticket cached) — manually invoke to hit it.
6. **Confirm the overload** — arg 1 is `byte[]` (protobuf), not `SortedMap`. Enumerate methods first.
