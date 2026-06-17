# Bilibili gRPC Capture — Methodology

Bilibili splits its traffic across two protocols, and a single feature can span both. This document
covers how the gRPC side is captured and decoded.

---

## 1. How Bilibili uses gRPC

| Feature | Protocol | Endpoint |
|---------|----------|----------|
| Comment **receive** (real-time push), danmaku | **gRPC / HTTP-2 / Protobuf** via `libignet.so` | `grpc.biliapi.net` |
| Comment **send** | **REST / HTTP-2** (form body, JSON response) | `api.bilibili.com` |

> A common early misconception is that comment-send is gRPC. It is **not** — sending is a REST POST
> to `/x/v2/reply/add` (see [`comment-api.md`](comment-api.md)). The read path (subscription) is gRPC.

gRPC domains seen: `grpc.biliapi.net` (native gRPC), `app.bilibili.com` (gRPC entry),
`broadcast.chat.bilibili.com` (chat/danmaku streaming).

---

## 2. Protobuf / HTTP-2 framing

gRPC binary metadata headers are themselves Protobuf, then Base64 (`x-bili-restriction-bin`,
`x-bili-locale-bin`). A gRPC DATA frame on the wire:

```
[1-byte compression flag gc] [4-byte big-endian length gl] [Protobuf message bytes]
  gc = 0  → uncompressed Protobuf (parse directly)
  gc = 1  → gzip-compressed Protobuf (inflate first, then parse)
```

Distinguish this from a plain REST HTTP-2 DATA frame, whose first byte is not a valid gc flag
(e.g. `0x1f` = gzip magic of a form body).

Example decoded `service_comment` subscription (Server-Streaming RPC):

```
→ grpc.biliapi.net  [gRPC DATA stream=53 51B]
  f1(str)="service_comment"
  f2(str)="Android-2.9.4"
  f3(str)="<OID>#1"          ← videoID#type   (<OID> is personal — masked)
```

### Protobuf walker

Minimal wire-format reader: each field tag byte → `field = b>>3`, `wire = b&7`:
`wire 0` varint, `wire 2` length-delimited (read varint length then bytes), `wire 5` skip 4,
`wire 1` skip 8. `.proto` definitions aren't bundled — community mirrors of the (now-archived)
`bilibili-API-collect` repo carry them.

---

## 3. Why proxies fail here

| Tool | gRPC? | Note |
|------|-------|------|
| Charles | ✗ | broken HTTP/2, silently drops gRPC |
| ProxyPin / Fiddler Classic | ✗ | no/poor HTTP/2 |
| mitmproxy / Fiddler Everywhere | partial | better HTTP/2 |
| Wireshark + tcpdump | raw only | ciphertext; needs proto files + TLS keys to decode |
| **Frida native hook** | ✓ | function-level, protocol-agnostic — the real solution |

**Root cause:** gRPC/comment traffic goes through `libignet.so` (Bilibili's self-built C++ network
stack) which opens **raw BSD sockets** and ignores the Android system proxy entirely. The gRPC
long-lived connection is also established at app startup; sending a comment merely opens a new Stream
on the existing connection, so a proxy intercepting at handshake never sees it. → Capture plaintext at
the native SSL layer instead ([`ssl-interception.md`](ssl-interception.md)).

---

## 4. Method A — tcpdump + Wireshark (confirms connections, not content)

Requires root + a statically-compiled `tcpdump`.

```bash
adb push tcpdump /data/local/tmp/tcpdump && adb shell chmod +x /data/local/tmp/tcpdump
# Force-stop FIRST so the gRPC long-connection handshake is captured:
adb shell am force-stop tv.danmaku.bili
adb shell su -c "/data/local/tmp/tcpdump -i any -w /sdcard/bili_grpc.pcap"
# ... open app, trigger action ...
adb shell su -c "pkill -2 tcpdump"        # SIGINT lets tcpdump flush; Ctrl+C truncates the pcap
adb pull /sdcard/bili_grpc.pcap
```

Wireshark filters:

```
tls.handshake.extensions_server_name contains "bili"
tls.handshake.extensions_server_name == "grpc.biliapi.net"
```

**Limitation:** all payload is TLS ciphertext — this confirms which connections exist but the content
is unreadable without plaintext interception (or exported TLS session keys).

---

## 5. Method B — Frida OkHttp hook (DEPRECATED)

A Java-layer `OkHttpClient.newCall` hook fails twice over: (1) `Java.perform` modifies the ART method
table → `libmsaoaidsec.so` scans the vtable and kills the process; (2) comment traffic never
traverses OkHttp (it's in `libignet.so`), so even a working hook sees nothing. Use native SSL hooking
instead.

---

## 6. Key findings

- Read path is a gRPC subscription; write path is REST — a deliberate read-stream vs write-request
  split.
- The protocol-agnostic golden hook is `SSL_write` / `SSL_read` — it sees both REST and gRPC plaintext
  regardless of destination.
- Future improvement: export the TLS session keys via the BoringSSL key callback to an
  `SSLKEYLOGFILE`, enabling full Wireshark decryption of captured pcaps.
