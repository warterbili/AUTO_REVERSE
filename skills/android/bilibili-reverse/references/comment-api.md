# Bilibili Comment API (`/x/v2/reply/add`) — Reverse-Engineering

The worked example that wires together `sign`, `x-bili-ticket`, and `access_key`. This document gives
the full header + body + sign contract and a catalog of the related endpoints.

---

## 1. Endpoint

| Field | Value |
|-------|-------|
| URL | `https://api.bilibili.com/x/v2/reply/add` |
| Method | `POST` |
| Protocol | HTTP/2 in-app (HTTP/1.1 works for replay) |
| Content-Type | `application/x-www-form-urlencoded; charset=utf-8` |
| Auth | body `access_key` + header `x-bili-ticket` |
| Anti-tamper | body `sign` (MD5) |
| appkey / appSecret | `1d8b6e7d45233436` / `560c52ccd288fed045859ed18bffd973` |

---

## 2. Request headers

HTTP/2 pseudo-headers (`:authority`, `:method`, `:path`, `:scheme`) are auto-set by the HTTP library.
The rest:

| Header | Value / source | Class |
|--------|----------------|-------|
| `accept` | `*/*` | fixed |
| `accept-encoding` | `gzip, deflate, br` | fixed |
| `app-key` | `android64` | fixed |
| `bili-http-engine` | `ignet` | fixed |
| `content-type` | `application/x-www-form-urlencoded; charset=utf-8` | fixed |
| `env` | `prod` | fixed |
| `x-bili-metadata-ip-region` | `CN` | fixed |
| `x-bili-metadata-legal-region` | `CN` | fixed |
| `x-bili-redirect` | `1` | fixed |
| `content-length` | body byte length | dynamic |
| `session_id` | 8-char random hex | per-request |
| `x-bili-trace-id` | random Base64 | per-request |
| `user-agent` | BiliDroid UA (below) | synthesized |
| `x-bili-ticket` | JWT (`eyJ...`), auto-refreshed | credential |
| `buvid` | `<BUVID>` | config (personal) |
| `x-bili-mid` | `<MID>` (e.g. `116xxxxxxxxxxxx`) | config (personal) |
| `fp_local` | 64-hex `<FP_LOCAL>` | config (personal) |
| `fp_remote` | `<FP_REMOTE>` (currently = fp_local) | config (personal) |
| `guestid` | `<GUESTID>` | config (personal) |
| `x-bili-aurora-eid` | `<AURORA_EID>` (Base64) | config (personal) |
| `x-bili-locale-bin` | Base64 locale protobuf | config |

**BiliDroid User-Agent** (public, hardcoded — note `bbcallen@gmail.com` is the public UA author
string, not personal):

```
Mozilla/5.0 BiliDroid/8.83.0 (bbcallen@gmail.com) 8.83.0 os/android model/MI 9 mobi_app/android build/8830500 channel/html5_search_google innerVer/8830510 osVer/13 network/2
```

> **Bilibili requires a UA on nearly every API** — a bare request returns HTTP 412 (risk-control page).

---

## 3. Request body parameters (24 + `sign`)

| Param | Example / source | Notes |
|-------|------------------|-------|
| `access_key` | `<ACCESS_KEY>` | config (personal) |
| `appkey` | `1d8b6e7d45233436` | hardcoded |
| `build` | `8830500` | config |
| `c_locale` | `zh-Hans_CN` | hardcoded |
| `channel` | `html5_search_google` | config |
| `container_uuid` | `uuid.uuid4()` | per-request (format-only) |
| `disable_rcmd` | `0` | hardcoded |
| `from_spmid` | `tm.recommend.0.0` | hardcoded |
| `has_vote_option` | `false` | hardcoded |
| `message` | the comment text | caller ★ |
| `mobi_app` | `android` | config |
| `oid` | `<OID>` (e.g. `116xxxxxxxxxxxx`) | caller — target video ID ★ |
| `ordering` | `heat` | hardcoded |
| `plat` | `2` | hardcoded |
| `platform` | `android` | config |
| `s_locale` | `zh-Hans_CN` | hardcoded |
| `scene` | `main` | hardcoded |
| `scm_action_id` | `secrets.token_hex(4).upper()` | per-request (format-only) |
| `spmid` | `united.player-video-detail.0.0` | hardcoded |
| `statistics` | `{"appId":1,"platform":3,"version":"8.83.0","abtest":""}` | compact JSON |
| `sync_to_dynamic` | `false` | hardcoded |
| `track_id` | `<TRACK_ID>` (optional, may be empty) | personal if present |
| `ts` | Unix seconds | per-request |
| `type` | `1` (1=video, 12=article) | caller ★ |
| `sign` | 32-hex MD5 | computed |

Of the per-request params, **only `sign` requires reversing**; `container_uuid`, `scm_action_id`,
`statistics` are format-only (not server-validated); `ts` just needs to be roughly current.
`message` uses bracketed-text emoji (a name in square brackets, e.g. the "laughing-crying" emoji, URL-encoded as `%5B%E7%AC%91%E5%93%AD%5D`), not Unicode emoji.

The `sign` algorithm is documented in full in [`app-api-sign.md`](app-api-sign.md).

---

## 4. Response

```json
{ "code": 0, "message": "OK", "ttl": 1,
  "data": { "rpid": <RPID>, "rpid_str": "<RPID>",
    "reply": { "rpid": <RPID>, "oid": <OID>, "type": 1, "mid": <MID>,
      "ctime": <TS>, "member": { "uname": "<UNAME>" } } } }
```

| code | meaning | fix |
|------|---------|-----|
| `0` | success | — |
| `-101` | `access_key` expired | refresh via `refresh_token` ([access-key-refresh.md](access-key-refresh.md)) |
| `-111` | csrf / sign check failed | verify sign computation + body encoding |
| `-412` | risk-control intercept | lower rate, check UA / IP / headers |
| `-509` | rate-limited | increase interval |

---

## 5. Related endpoints (catalog)

The full request depends on two credential endpoints:

```
refresh_token (→ new access_key)        passport.bilibili.com/x/passport-login/oauth2/refresh_token
   → GenWebTicket (→ ticket JWT)         api.bilibili.com/bapis/.../Ticket/GenWebTicket
      → /x/v2/reply/add (needs ticket + access_key + sign)
```

See [`access-key-refresh.md`](access-key-refresh.md) and [`ticket.md`](ticket.md). The comment-receive
(real-time push) path is gRPC — see [`grpc-capture.md`](grpc-capture.md).

---

## 6. Methodology

The comment flow was captured via native SSL hooking (`scripts/frida/ssl_hook.js`):
`frida -U -f tv.danmaku.bili -l scripts/frida/bypass.js -l scripts/frida/ssl_hook.js`, then post a
comment in the app and read the plaintext request. Fully decoding the request **headers** additionally
requires HPACK (static table + RFC 7541 Huffman + per-connection dynamic table, accumulated from frame
zero in spawn mode); the **body** (where `sign` lives) comes straight out of `SSL_write`.

---

## 7. Gotchas

1. **Body bytes must byte-for-byte equal the string you signed.** Build the body manually:
   ```python
   body = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in sorted(signed.items()))
   client.post(url, content=body.encode("utf-8"), headers=headers)
   ```
   Do **not** use `httpx.post(url, data=dict)` — its internal encoding may differ → `-111`. This is the
   single most common failure.
2. **Always send a UA** — bare requests → 412.
3. **Risk control** — randomize intervals and vary content for batch operations to avoid `-412`/`-509`.
4. **`access_key` is the most fragile credential** — ~180-day life, auto-refreshable; check first on
   failure.
5. **Device fields** (`buvid`, `fp_local`, `fp_remote`, `guestid`, `aurora_eid`) never expire —
   capture once per device.
6. **`build` is app-version-bound** (8.83.0 → `8830500`) and must match the UA's `build`.
