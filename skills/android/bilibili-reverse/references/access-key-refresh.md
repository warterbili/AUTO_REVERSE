# Bilibili `access_key` / `refresh_token` OAuth2 Refresh — Reverse-Engineering

Bilibili Android uses a standard OAuth2 dual-token scheme: a (relatively) long-lived `access_key`
(≈180 days) plus a `refresh_token`. This document covers the refresh endpoint, the request/response
contract, the token lifecycle, and the methodology. The refresh request is signed with the **same**
`sign` algorithm as every other API (see [`app-api-sign.md`](app-api-sign.md)), so no new native work
is required.

---

## 1. Endpoint

```
POST https://passport.bilibili.com/x/passport-login/oauth2/refresh_token
Content-Type: application/x-www-form-urlencoded
```

> Old community docs reference `/api/v2/oauth2/refresh_token` — **outdated**. The current app uses the
> path above (confirmed from the Retrofit annotation).

Retrofit interface (source of truth):

```java
@FormUrlEncoded
@POST("/x/passport-login/oauth2/refresh_token")
@RequestInterceptor(AuthInterceptor.class)
BiliCall<GeneralResponse<AuthInfo>> refreshTokenV2(
    @Field("access_key")    String access_key,
    @Field("refresh_token") String refresh_token,
    @Field("sts")           String sts,
    @FieldMap               Map<String, String> commonParams);
```

---

## 2. Request parameters

Explicit `@Field`s: `access_key`, `refresh_token`, `sts`. Common params added by
`AuthInterceptor.addCommonParam` (`@FieldMap`):

| Param | Value |
|-------|-------|
| `access_key` | current access token — sent even if expired → `<ACCESS_KEY>` |
| `appkey` | `1d8b6e7d45233436` |
| `build` | `8830500` |
| `buvid` | device BUVID → `<BUVID>` |
| `c_locale` | `zh-Hans_CN` |
| `channel` | `html5_search_google` |
| `local_id` | same as buvid → `<BUVID>` |
| `mobi_app` | `android` |
| `platform` | `android` |
| `refresh_token` | current refresh token → `<REFRESH_TOKEN>` |
| `s_locale` | `zh-Hans_CN` |
| `sts` | Unix timestamp (seconds) — same semantics as `ts` |
| `sign` | MD5 signature (see app-api-sign.md) |

- **Body encoding:** `application/x-www-form-urlencoded`, params sorted by key before signing.
  Build the body the **same way** you signed it (manual `quote(safe='')`, raw bytes) — see gotchas.
- **Signing:** `AuthInterceptor.signQuery` → `LibBili.signQuery(map)` — the identical MD5+appSecret
  algorithm. `scripts/bili_refresh.py` reuses `bili_sign.py`.

---

## 3. Response

```json
{
  "code": 0,
  "data": {
    "token_info": {
      "mid": 116xxxxxxxxxxxx,
      "access_token": "<ACCESS_KEY>",
      "refresh_token": "<REFRESH_TOKEN>",
      "expires_in": 15552000
    },
    "cookie_info": { "...": "..." }
  }
}
```

- `token_info.access_token` — new `access_key`
- `token_info.refresh_token` — new `refresh_token`
- `token_info.mid` — user UID → `116xxxxxxxxxxxx`
- `token_info.expires_in` — **15552000 s ≈ 180 days**

---

## 4. Token lifecycle

- Dual-token OAuth2: `access_token` (~180 days) + a longer-lived `refresh_token`.
- **Both tokens rotate on every refresh.** The old `refresh_token` is invalidated and cannot be
  reused. **You must persist the new `refresh_token` after each refresh** or you lose the ability to
  refresh and must re-login (QR / SMS / password).
- An expired `access_key` on an API call returns error code **`-101`** ("not logged in"); that is the
  signal to refresh.
- App helpers: `AccessToken.isExpired()` / `isValid()` / `canRefresh()`,
  `BiliAccounts.isTokenExpired()`, `signedInWithToken(AuthInfo)` to persist.

### In-app storage

`com.bilibili.lib.accounts.model.AccessToken` holds `mAccessKey`, `mRefreshToken`, `mExpires`,
`mExpiresIn`, `mMid`, `mFastLoginToken` in one in-memory object, persisted by `AccountStorage` —
**not** in SharedPreferences. Supporting classes: `BiliAccounts` (facade), `BiliAuthService`
(Retrofit), `BiliPassportApi` (`U()` caller), `AuthInterceptor` (common params + sign), `AuthInfo`
(response model).

---

## 5. Methodology

1. **Class-name search** (`trace_access_token.js`): `enumerateLoadedClasses` filtered on
   `refreshtoken`/`accesstoken`/`biliauth` (excluding `facebook`/`sina`) → `model.AccessToken`.
2. **Field/method enumeration** on `model.AccessToken` → field `mRefreshToken`.
3. **`Java.choose` / `dump_tokens.js`:** enumerate live `AccessToken` instances → read `mAccessKey`,
   `mRefreshToken`, `mMid`, `mExpires`, `canRefresh()`. (All captured values here are personal —
   `<ACCESS_KEY>`, `<REFRESH_TOKEN>`, `116xxxxxxxxxxxx`.)
4. **Package sweep** of `com.bilibili.lib.accounts` → map the supporting classes.
5. **Method enumeration** on `BiliAuthService` → `refreshTokenV2(String, String, String, Map)`.
6. **jadx** → read the `@POST`/`@Field` annotations (endpoint + params), the caller
   `BiliPassportApi.U()`, `AuthInterceptor.addCommonParam`, and confirm `signQuery` →
   `LibBili.signQuery` (sign reuse — no SO work needed).
7. **Frida hook + manual trigger:** hook `BiliPassportApi.U` and **manually invoke it** (the token
   won't naturally expire for 180 days) → confirm `sts` = Unix seconds, then re-read memory to watch
   both tokens rotate and `expires` advance.

---

## 6. Gotchas

1. **`refresh_token` is not in SharedPreferences** — grep over `shared_prefs` is empty. Use
   `Java.choose` on the in-memory model object.
2. **`Java.choose` filtering on `mMid` with `===` fails** (`mMid` is a Java `long`) — drop the filter
   and print all instances.
3. **jadx searching `.U(` is too generic** — search `refreshTokenV2` to find the caller.
4. **Old endpoint path is outdated** — trust the jadx-reversed
   `/x/passport-login/oauth2/refresh_token`.
5. **Keep the whole refresh + verify sequence in one `Java.perform` block** — each `Java.perform` is
   an independent REPL scope; the `api` handle is lost otherwise.
6. **Refresh rotates both tokens** — persist the new `refresh_token` or the next refresh fails.
