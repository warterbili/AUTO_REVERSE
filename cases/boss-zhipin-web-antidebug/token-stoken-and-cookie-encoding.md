# Boss `__zp_stoken__` — token / seed / cookie-encoding (complete, verified)

> Companion to [`case.md`](case.md). This is the **token** half of the engagement (the anti-debug half
> is in `case.md` / `detection-points.md`). Everything here was verified live (≥3 reproductions for
> stochastic results). Token/seed values are ephemeral session data — shown as **truncated tails /
> placeholders only**, never full values.

## One-sentence conclusion

You CAN generate `__zp_stoken__` outside the browser and use it from plain Python — the algorithm was
never the blocker. The blocker that wasted most of this investigation was a **cookie-encoding bug**:
the token contains `+` and `/`, the browser stores it **URL-encoded**, and storing it raw makes the
server URL-decode `+`→space → corrupted token → `code:37`. Fix = `encodeURIComponent(token)` /
`urllib.parse.quote(token, safe='')`.

---

## 1. The token algorithm (verified)

```js
__zp_stoken__ = new ABC().z(seed, parseInt(ts) + 60*(480 + new Date().getTimezoneOffset())*1000)
```
- `ABC` is defined in a **per-challenge security script** `/web/passport/zp/security-js/<rotating-name>.js`
  (the name rotates, e.g. `7c91433f.js` — it is NOT the account id). It loads into an **iframe**;
  `window.ABC` is undefined on the top window — you reach it via `window.frames[i].ABC`.
- The gateway that calls `(new ABC).z(...)` is `r()` in **`app~2.<hash>.js`** (the SPA bundle), NOT
  `main.js`. (`main.js`'s copy of `setGatewayCookie`/`r` exists but is the SEO build's; the SPA uses
  app~2.) — this is why patching main.js to trace the call never fired.
- **`z()` is non-deterministic**: same `(seed, ts)` → a different token every call (embedded entropy).
  So the server cannot validate by recomputing — it validates a signature it can verify from the seed.
- `z()` reads a device fingerprint (canvas `fillText`+`toDataURL`, WebGL vendor/renderer, screen).
  Feeding a Node stub a real canvas+WebGL moved the token length 305→349→… toward the browser's ~441.

## 2. The seed (verified)

- **Source: the `code:37` response.** When a request carries no valid `__zp_stoken__`, the server returns
  `{"code":37,"message":"您的环境存在异常.","zpData":{"seed":"<seed>","name":"<scriptName>","ts":<ms>}}`.
  Proven server-side: a **plain Python request (no browser, no JS) receives the seed directly** in that
  HTTP body. There is **no client-side seed generation**; the client relays the server seed verbatim to
  `z()` (an externally-passed raw 37-seed produced a server-accepted token, 3/3).
- **Caching: `localStorage['passport_config']`** holds the cached 37 response
  (`{...zhipin_geek_spa_web:{code:37,data:{...zpData:{seed,name,ts}}}}`). Proactive token refreshes read
  the seed from here — **no new 37 needed per refresh**.
- **Shape:** ~44-char base64; a **constant prefix** (`sKU0…`, account/session-bound) + a per-challenge
  varying suffix. (Whether the prefix is account- vs session-bound was not isolated.)
- **Reuse limit: ~5 uses per seed** (verified 3/3: tokens 1–5 accepted, 6+ → `code:37`; count-based, not
  time-based). After exhaustion, trigger a new 37 for a fresh seed. (Whether the "5" is a strict per-seed
  quota vs a session rate-limit was not isolated.)
- **Warm session:** 0 `code:37`, cached seed constant — which is why normal packet capture shows **no
  seed delivery**: it was delivered once (a past 37) and is reused from localStorage.

## 3. THE ROOT CAUSE — cookie encoding (verified 3/3)

The token contains `+` and `/`. The browser's `Cookie.set` stores `__zp_stoken__` **URL-encoded**:

```
z() output (raw):   ...JcFvCh2h5wodkw4bCgGp8wrlxdsK4d.../   (has +  and /)
cookie as stored:   ...JcFvCh2h5wodkw4bCgGp8wrlxdsK4d...%2F  (encodeURIComponent)
verified:  encodeURIComponent(z_output) === the stored cookie value
```

Isolation (same token value, vary only the cookie encoding):

| cookie form | result |
|---|---|
| browser's stored (URL-encoded) | `code:0`, 30 jobs |
| **set RAW / unencoded** | **`code:37`** (3/3) |
| **set `encodeURIComponent`** | `code:0`, 30 jobs |

**Why raw fails:** the server URL-decodes the cookie; a literal `+` decodes to a **space**, corrupting the
token. So a structurally-correct token, stored raw, arrives corrupted → "环境异常".

**Fix:** always `encodeURIComponent(token)` (JS) / `urllib.parse.quote(token, safe='')` (Python) before
putting `__zp_stoken__` in a cookie. A valid, correctly-encoded `__zp_stoken__` cookie is sufficient
auth (the `zp_token`/`token`/`traceId` request headers are added by the app but were NOT required —
a raw Python fetch with only the cookie returned `code:0`). `get/zpToken` returns the `zp_token` header,
not the seed.

## 4. Working external mode (file-replace + RPC + Python) — verified 3/3

The exact mode requested: expose the gen function via **file replacement**, front-end↔back-end RPC, pull
the token value out, send the request from **plain Python**.

```
①  file-replacement injects a front-end into the page:
      - append to security-js:  window.top.__BOSS_ABC__ = window.ABC   (expose the iframe's ABC)
      - prepend an RPC poller to a static bundle
②  Python back-end ↔ front-end (HTTP poll/result):
      back-end GET joblist → code:37 → {seed, ts}
      → command front-end: token = (new __BOSS_ABC__()).z(seed, ts_tz_adjusted)
      → front-end returns token
③  back-end: enc = quote(token, safe='')   ← THE FIX
      set __zp_stoken__=enc cookie ; Python requests.get(joblist)
④  → code:0, 30 real jobs.   (3/3)
```
Runnable copies: [`rpc3-inject.js`](rpc3-inject.js) (front-end injector), [`rpc3-backend.py`](rpc3-backend.py).

## 5. How the GitHub reference project avoids all this

`warterbili/BossZhipin_reverse` sends every data request **through the browser** (`sess.fetch` →
`bus.send("fetch_url")` → the injected poller runs `fetch(url,{credentials:'include'})` in-page). The
browser's own zpAegis handles the token **and its cookie encoding** natively, so the project never hits
the encoding bug. Its `injection.js` ABC exposure / `gen_stoken` is **debug-only** — no data operation
uses it. So for the data path, ABC exposure is unnecessary; the project is "RPC of the request", not
"RPC of the token function".

## 6. Methodology post-mortem (why this took far too long)

- **The encoding bug was trivially findable by diffing my cookie against the browser's.** The browser's
  stored `__zp_stoken__` ends `…%2F`; mine ended `…/`. One `===` / visual diff of the two cookie values
  shows the encoding difference immediately. I theorized for many rounds instead of doing that diff —
  **the lesson: when "browser works, my replay doesn't", byte-diff the two actual requests/cookies first.**
- **Patch the right file.** I traced `z()` by hooking `ABC.prototype.z` (defeated by JSVMP obfuscation)
  and by patching `main.js` (wrong bundle). What worked: **file-replacing the `security-js` itself and
  appending a wrapper** (same execution context as ABC → beats obfuscation + timing); the call lives in
  `app~2`, not main.js.
- **Don't state causes you haven't isolated.** I asserted "iframe destroyed", "must be blessed via
  set/zpToken", "risk-control escalation", "one-time seed" — all wrong or unverified. Every one was a
  hypothesis dressed as a conclusion. See `AGENTS.md` rule #3 (strengthened because of this case).

## Deliverables

| File | Description |
|---|---|
| `token-stoken-and-cookie-encoding.md` | This doc — token/seed/cookie-encoding, verified |
| `rpc3-inject.js` | File-replacement front-end injector (expose ABC + RPC poller) |
| `rpc3-backend.py` | Python back-end: gen via RPC → **URL-encode** → external request |
