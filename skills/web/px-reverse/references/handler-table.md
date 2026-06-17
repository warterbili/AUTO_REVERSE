# Complete OB Handler Table (27 handlers, matched by argument shape — version-agnostic)

## Recommended approach: match by argument shape (**not** by handler name)

| Match rule | state set | Meaning |
|---|---|---|
| 1 arg, `/^1[5-9]\d{11}$/` (13-digit ms ts) | `state.no` | Server timestamp |
| 1 arg, `/^[0-9a-f]{64}$/` | `state.qa` | challenge_hash (cs) |
| 3 args, UUID + number + flag | `state.vid` | Visitor ID |
| 2 args, UUID + flag | `state.cts` | Client timestamp |
| 1 arg, UUID | `state.pxsid` | Session UUID |
| 1-2 args, `/^\d{16,}$/` | `state.to` | Session token (anti-tamper seed) |
| 1 arg, `/^\d{3}$/` | `state.ao` | Status code |
| **4+ args, `/^_?px/i`** | `state.px3 = {name, value, ttl}` | **⭐ set_cookie** |
| 1 arg, `/^[a-z0-9]{12,30}$/` | `state.appId` | Session appId |
| 1 arg, `/^[a-z]{2,4}$/` | `state.jf` | control_flag |
| 1 arg, `/^\d{4,5}$/` | `state.o111val` | (unspecified) |
| 3 args, `"cc"/"rf"/"tm"` + ttl + base64 | cookie_config | Config cookie |
| 1 arg, `"ai:N,uiii:N"` | feature_flags | Feature toggles |
| 2 args, b64hash:payload + "true" | pxhd injection | Warm-visit only |

## Wire character encoding version reference

```
Old SDK (2025-): byte charset 'o', '1'
  e.g. 'o111oo1o' (timestamp handler)

New SDK (2026-05+): byte charset '0', 'l'
  e.g. '0lll000l' (same handler)

SDK function names: 'lllOll', 'OOlOlO', etc. (uppercase-O / lowercase-l,
  not necessarily aligned with the wire characters)
```

## Old wire -> new wire mapping

| handler | Old wire | New wire |
|---|---|---|
| timestamp | `o111oo1o` | `0lll000l` |
| challenge_hash | `1o1111` | `0lllll` |
| vid | `oooo11` | `0000ll` |
| cts | `o11o11o1` | `0ll0ll00` |
| pxsid | `oo1o1o` | `l0l0ll` |
| session_id (to) | `ooo11o` | `l0l0ll` |
| **set_cookie** | `o11111` | `000lll` |
| app_id | `o111o1` | `000ll0` |
| control_flag | `1o1o11` | `0lll0l` |
| o111val | `o111ooo1` | `0lll0000` |
| cookie_config | `o1111o` | `l00lll` |
| feature_flags | `o111oo` | `l00ll0` |

## Key reminders

⚠️ **Do not rely on handler names for identification!** Wire characters can change on every SDK upgrade.
✅ **Match by argument shape** — `args.length` + content regex.

⚠️ **`set_cookie` is the sole source of `_px3`**: 4+ args with the first arg being `_px3` (or similar `_pxN`).
✅ Extract `state.px3 = { name: args[0], value: args[2], ttl: parseInt(args[1]) }`.
