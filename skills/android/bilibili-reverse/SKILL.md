---
name: bilibili-reverse
description: Bilibili (哔哩哔哩 / b站) Android API reverse-engineering skill — reconstruct Bilibili's APP-API protection and request signing end to end. Covers the APP-API `sign` parameter (appkey + appSecret + MD5 over sorted params, computed inside libbili.so), the `x-bili-ticket` JWT / GenWebTicket HMAC, the OAuth2 `access_key` / `refresh_token` refresh flow, native gRPC capture, native SSL plaintext interception (SSL_write/SSL_read), and the comment API (/x/v2/reply/add). Use when the user mentions bilibili, b站, 哔哩哔哩, BiliDroid, libbili.so, APP-API sign, appkey 1d8b6e7d45233436, x-bili-ticket, access_key / refresh_token refresh, or any reversing of Bilibili Android API requests.
languages: [en, zh]
status: validated against BiliDroid 8.83.0 (build 8830500); sign / ticket / access_key / comment all confirmed against live captures
---

# Bilibili Android API Reverse-Engineering Skill

> **TL;DR**: Reconstruct Bilibili's Android APP-API request chain with pure math + a small set of
> native Frida hooks. Input: a captured request. Output: scripts that regenerate the protected
> fields (`sign`, `x-bili-ticket`, refreshed `access_key`) and replay any signed endpoint.
>
> Every constant and offset below comes from **live native hooks** against `libbili.so`, never from
> stale community docs (which are repeatedly shown to be wrong about endpoints/keys).

This is a **specialized target asset** — a Bilibili-specific counterpart to `web/px-reverse`. It keeps
full reverse-engineering depth (algorithms, native offsets, methodology). It contains **no personal
session data**: all tokens are placeholders, and every script reads secrets from a config/env.

---

## When to invoke

Trigger keywords:

- `bilibili`, `b站`, `哔哩哔哩`, `BiliDroid`, `tv.danmaku.bili`
- `libbili.so`, `libignet.so`, `libmsaoaidsec.so`
- `sign`, `appkey 1d8b6e7d45233436`, `appSecret`, `signQuery`
- `x-bili-ticket`, `GenWebTicket`, `GetTicket`
- `access_key`, `refresh_token`, `oauth2/refresh_token`
- "reverse bilibili sign", "bilibili comment API", "bilibili gRPC", "bilibili SSL plaintext"

**For Bilibili Android only.** Other apps / generic anti-bot SDKs → use the generic skills
(`frida-mitm-capture`, `frida-hooking`, `android-re-decompile`).

---

## The 6 protection mechanisms (and where each is documented)

| # | Mechanism | What it protects | Reference |
|---|-----------|------------------|-----------|
| 1 | **APP-API `sign`** | MD5(sorted params + appSecret) — anti-tamper on almost every API | [`references/app-api-sign.md`](references/app-api-sign.md) |
| 2 | **`x-bili-ticket`** | server-issued JWT, HMAC-SHA256 signed request to GenWebTicket | [`references/ticket.md`](references/ticket.md) |
| 3 | **`access_key` refresh** | OAuth2 dual-token refresh (access + refresh rotate together) | [`references/access-key-refresh.md`](references/access-key-refresh.md) |
| 4 | **gRPC transport** | comment-receive / danmaku over HTTP/2 + Protobuf via `libignet.so` | [`references/grpc-capture.md`](references/grpc-capture.md) |
| 5 | **SSL plaintext interception** | native `SSL_write`/`SSL_read` hook (beats proxies + cert pinning) | [`references/ssl-interception.md`](references/ssl-interception.md) |
| 6 | **Comment API** | `/x/v2/reply/add` — full header + body + sign contract | [`references/comment-api.md`](references/comment-api.md) |

---

## 🔴 Read order (most efficient path)

1. **`references/ssl-interception.md`** — first get plaintext. Proxies (Charles/mitmproxy) fail here
   because `libignet.so` ignores the system proxy and Bilibili bundles its own BoringSSL. The native
   `SSL_write`/`SSL_read` hook is the foundation everything else is captured through.
2. **`references/app-api-sign.md`** ⭐ — the `sign` algorithm + the `libbili.so` native chain + how the
   appSecret was dumped. The single most reused mechanism.
3. **`references/ticket.md`** + **`references/access-key-refresh.md`** — the two credential mechanisms.
4. **`references/comment-api.md`** — the worked example that wires all of the above together.
5. **`references/grpc-capture.md`** — only when the target traffic is gRPC (comment-receive, danmaku).

---

## 🔑 Public constants (extracted from live captures — keep these)

These are Bilibili's public, hardcoded values, confirmed by native hooks. They are part of the
deliverable, **not** personal data.

| Constant | Value |
|----------|-------|
| Android appkey | `1d8b6e7d45233436` |
| Android appSecret | `560c52ccd288fed045859ed18bffd973` |
| appSecret as 4×uint32 (how it's stored in `libbili.so`) | `[0x560c52cc, 0xd288fed0, 0x45859ed1, 0x8bffd973]` |
| Ticket HMAC key_id (Android) | `ec01` |
| Ticket HMAC key (Android) | `Ezlc3tgtl` |
| Ticket HMAC key_id / key (Web) | `ec02` / `XgwSnGZ1p` |
| BiliDroid User-Agent (public, hardcoded) | `Mozilla/5.0 BiliDroid/8.83.0 (bbcallen@gmail.com) 8.83.0 os/android model/MI 9 mobi_app/android build/8830500 channel/html5_search_google innerVer/8830510 osVer/13 network/2` |

> The UA literally contains `bbcallen@gmail.com` — that is Bilibili's **public hardcoded** UA author
> string (ijkplayer / bbcallen), **not** a personal address. Keep it verbatim.

Other community-documented appSecrets (kept for completeness; only the first is verified here):

| appkey context | appSecret |
|---|---|
| `android_current` | `560c52ccd288fed045859ed18bffd973` |
| `android_old` | `ea85624dfcf12d7cc7b2b3a94fac1f2c` |
| `web` | `59b43e04ad6965f34319062b478f83dd` |
| `other` | `8e9fc618fbd41a0d8cda9ab5e09d752f` |

---

## 🛠️ Bundled scripts (`scripts/`)

### Python modules (algorithm reimplementations — `import`-able)

| Script | Purpose |
|--------|---------|
| `bili_sign.py` | The `sign` algorithm (MD5 streaming with 4×`%08x` secret words). `make_sign()` / `sign_params()` |
| `bili_ticket.py` | `gen_ticket()` — HMAC-SHA256 GenWebTicket request + validity check |
| `bili_refresh.py` | `refresh_access_key()` — OAuth2 refresh; reuses `bili_sign` |
| `bili_comment.py` | Worked end-to-end example: build headers + body + sign → POST `/x/v2/reply/add` |
| `config.example.json` | Config template — **copy to `config.json` and fill your own captured secrets** |

### Frida scripts (native hooks)

| Script | Purpose |
|--------|---------|
| `frida/bypass.js` | Defeat `libmsaoaidsec.so` anti-Frida (hook `dlsym`, neutralize `pthread_create`). **Load first.** |
| `frida/ssl_hook.js` | Hook `SSL_write`/`SSL_read` on **both** libssl.so (Conscrypt + bundled BoringSSL) — plaintext dump |
| `frida/hook_appsecret.js` | Attach `FUN_00118ff0` in `libbili.so`, read the appSecret from `args[3]` (4×uint32) |
| `frida/hook_sign.js` | Hook `art::ClassLinker::RegisterNative` to recover dynamically-registered native offsets |

All Frida scripts run in **spawn mode** (`frida -U -f tv.danmaku.bili -l bypass.js -l ...`) so the
bypass is in place before `libmsaoaidsec.so` starts its detection thread.

---

## 📋 Standard workflow (reverse a new Bilibili signed endpoint)

```
Stage 1 — Get plaintext  [references/ssl-interception.md]
  frida -U -f tv.danmaku.bili -l scripts/frida/bypass.js -l scripts/frida/ssl_hook.js
  Trigger the target action in the app; read the plaintext request (headers + body).

Stage 2 — Identify the protected fields
  sign      → present on almost every API (see app-api-sign.md)
  x-bili-ticket header → JWT, refreshed via GenWebTicket (ticket.md)
  access_key body field → OAuth credential, refreshable (access-key-refresh.md)

Stage 3 — Reproduce the sign
  Sort params by key, URL-encode each value (quote safe=''), join "k=v&...",
  MD5_Update(joined) + 4× MD5_Update("%08x" % secret_word) → hexdigest.
  scripts/bili_sign.py implements this exactly. Verify: your sign == captured sign.

Stage 4 — Reproduce the credentials
  ticket : scripts/bili_ticket.py  (HMAC-SHA256("ts"+ts, key="Ezlc3tgtl"))
  token  : scripts/bili_refresh.py (OAuth2 refresh, signed with bili_sign)

Stage 5 — Replay
  Build the body string the SAME way you signed it (manual quote, send raw bytes — NOT data=dict).
  See scripts/bili_comment.py for the full contract.
```

---

## ⚠️ Top gotchas (full lists live in each reference)

1. **Body bytes must byte-for-byte equal the string you signed.** Build the body manually with
   `quote(str(v), safe='')`; do **not** let an HTTP client re-encode a dict (`data={...}`) — its
   encoding differs → server rejects with `-111` (csrf/sign mismatch).
2. **Values must be URL-encoded before hashing.** The native serializer percent-encodes non-ASCII and
   special chars; signing raw values yields a wrong `sign`.
3. **Never use `Java.perform` against Bilibili.** It mutates the ART method table; `libmsaoaidsec.so`
   scans the vtable and kills the process in ~3 s. Use pure native `Interceptor.attach` only.
4. **Two `libssl.so`.** OkHttp uses system Conscrypt; `libignet.so` lazy-`dlopen`s a **bundled
   BoringSSL** only on the first network request. Poll and hook both (see ssl-interception.md).
5. **Always send a User-Agent.** A bare request → HTTP 412 risk-control page.
6. **Refresh rotates both tokens.** Persist the new `refresh_token` every time or you can never
   refresh again (forced re-login).
7. **Ghidra base is `0x100000`.** File / runtime offset = Ghidra addr − `0x100000`
   (e.g. `0x118ff0` → `0x18ff0`).
8. **Old community docs are wrong.** The refresh path is `/x/passport-login/oauth2/refresh_token`
   (not `/api/v2/...`); the appSecret lives as 4×uint32 not a string. Trust live captures.

---

## ⚠️ Desensitization notice

This skill is open-source. It contains **no** real `access_key`, `refresh_token`, `buvid`, `mid`,
`oid`, `track_id`, `container_uuid`, cookies, or session tokens — all are placeholders
(`<ACCESS_KEY>`, `<BUVID>`, `116xxxxxxxxxxxx`, …). Every script reads secrets from `config.json`
(copy `config.example.json`). The public reverse-engineering knowledge (appkey/secret pairs,
algorithms, native offsets, the BiliDroid UA) is intentionally kept.

---

## ✅ Validation criteria

| Mechanism | Pass criterion |
|-----------|----------------|
| `sign` | Recomputed `sign` byte-equals a captured request's `sign` |
| `x-bili-ticket` | GenWebTicket returns `code:0` with a JWT (`eyJ...`) |
| `access_key` refresh | `oauth2/refresh_token` returns `code:0` with a new `token_info` |
| Comment | `/x/v2/reply/add` returns `code:0` with an `rpid` |

---

## ❌ Natural-language traps

1. **"Just MD5 the params."** — wrong; the secret is streamed as 4×`%08x` words and values are
   URL-encoded first. One byte off = wrong sign.
2. **"Use a proxy to capture it."** — proxies miss `libignet.so` traffic entirely. Hook native SSL.
3. **"The community doc says endpoint X."** — verify against a live capture; the docs are stale.
4. **"`Java.use().implementation = ...` to hook."** — gets the process killed; native attach only.
