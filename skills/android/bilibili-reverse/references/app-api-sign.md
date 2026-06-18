# Bilibili APP-API `sign` — Algorithm & Reverse-Engineering

The `sign` parameter is an MD5 anti-tamper signature attached to almost every Bilibili Android
APP-API request. It is computed natively inside `libbili.so` (reached from Java via
`com.bilibili.nativelibrary.LibBili`). This document covers the exact algorithm, the public
constants, the native call chain, and the methodology used to recover them.

---

## 1. The algorithm

Given the request parameter map (without `sign`):

1. **Sort by key** — lexicographically (alphabetical). Java wraps the map in `new TreeMap(map)`
   before the JNI call, so the native side receives a `SortedMap`.
2. **URL-encode each value** — full percent-encoding, equivalent to `quote(v, safe='')`. Non-ASCII
   and special characters are encoded; keys are not. (e.g. a CJK `message` value such as `haha`
   written in Chinese → `message=%E5%93%88%E5%93%88`,
   `statistics={...}` → `statistics=%7B...%7D`.)
3. **Concatenate** — `key1=val1&key2=val2&...` in sorted order with encoded values.
4. **MD5 streaming** (the load-bearing detail):
   - `MD5_Init(ctx)`
   - `MD5_Update(ctx, sorted_params)`
   - for each of the 4 secret words `secret[i]` (i = 0..3): format as `"%08x"` (8 lowercase
     zero-padded hex chars) and `MD5_Update(ctx, that_8_char_string)`
   - `MD5_Final(ctx)` → 16 bytes
5. **Hex-encode** — `"%02x"` per digest byte → 32-char lowercase hex string = `sign`.

### Key subtlety

The appSecret is **not** concatenated into the params string before hashing. It is streamed into the
MD5 context separately as the hex rendering of 4 `uint32` words, in four `"%08x"` chunks. Because
`MD5_Update(A) + MD5_Update(B) == MD5(A + B)`, this is mathematically equivalent to
`MD5(sorted_params + "560c52ccd288fed045859ed18bffd973")`. Storing the secret as 4 uint32 (not a
string) is deliberate — it defeats `strings`/grep over the binary.

### Reference implementation (verified, see `scripts/bili_sign.py`)

```python
import hashlib
from urllib.parse import quote

_SECRET_UINT32 = [0x560c52cc, 0xd288fed0, 0x45859ed1, 0x8bffd973]

def make_sign(params: dict) -> str:
    sorted_params = "&".join(
        f"{k}={quote(str(v), safe='')}" for k, v in sorted(params.items())
    )
    ctx = hashlib.md5()
    ctx.update(sorted_params.encode("utf-8"))
    for v in _SECRET_UINT32:
        ctx.update(("%08x" % v).encode("utf-8"))
    return ctx.hexdigest()
```

Validated: the recomputed `sign` byte-matches captured requests exactly.

---

## 2. Public constants (keep — these are not personal data)

| Field | Value |
|-------|-------|
| appkey (Android) | `1d8b6e7d45233436` |
| appSecret (Android) | `560c52ccd288fed045859ed18bffd973` |
| SECRET_UINT32 array | `[0x560c52cc, 0xd288fed0, 0x45859ed1, 0x8bffd973]` |

Word-by-word decomposition (how the 32-char secret maps to the 4 uint32 fed via `%08x`):

| Word | uint32 | `%08x` |
|------|--------|--------|
| secret[0] | `0x560c52cc` | `560c52cc` |
| secret[1] | `0xd288fed0` | `d288fed0` |
| secret[2] | `0x45859ed1` | `45859ed1` |
| secret[3] | `0x8bffd973` | `8bffd973` |

The native secret-selector (`FUN_0011605c`) holds **three** candidate data blocks
(`UNK_001c0a60`, `UNK_001c0b90`, `DAT_001c0cc0`) keyed by appkey/version — i.e. multiple
appkey→secret entries exist. Only the `1d8b6e7d45233436 → 560c52cc...` pair was dumped and verified.

---

## 3. Native call chain in `libbili.so`

Ghidra load base `0x100000`; file/runtime offset = Ghidra addr − `0x100000`.

```
FUN_00109050   (+0x9050)   JNI entry: (JNIEnv*, jclass, jobject SortedMap)  ← LibBili.s(SortedMap)
   └─ FUN_0011629c          transparent forwarder
        └─ FUN_001162a8     CORE — OLLVM control-flow-flattened state machine
             ├─ FUN_00117de4(env, sortedMap)
             │     serialize TreeMap → "key=urlencoded_val&..." (JNI vtable +0x390 = Java URL-encode)
             ├─ FUN_0011605c(appkey/version)
             │     table lookup → appSecret block pointer
             └─ FUN_00118ff0(out, sorted_params, len, secret_ptr)
                   MD5 → 32-char hex sign
```

### MD5 leaf — `FUN_00118ff0` (file offset `0x18ff0`)

| Wrapper | Real routine |
|---------|--------------|
| `FUN_0010ffac` | `MD5_Init` |
| `FUN_0010ffc0` | `MD5_Update` |
| `FUN_00112dd0` | `MD5_Final` |

```c
void FUN_00118ff0(char *out, char *sorted_params, int len, uint32_t *secret) {
    MD5_CTX ctx;
    FUN_0010ffac(&ctx);                                 // MD5_Init
    FUN_0010ffc0(&ctx, sorted_params, len);             // MD5_Update(params)
    for (int i = 0; i < 4; i++) {
        char buf[9];
        sprintf(buf, DAT_001d8844, secret[i]);          // DAT_001d8844 = "%08x"
        FUN_0010ffc0(&ctx, buf, 8);                     // MD5_Update(8 hex chars)
    }
    byte digest[16];
    FUN_00112dd0(digest, &ctx);                         // MD5_Final
    for (int i = 0; i < 16; i++)
        sprintf(out + i*2, DAT_001d8cbc, digest[i]);    // DAT_001d8cbc = "%02x"
}
```

### Notable addresses / obfuscation

| Symbol | Meaning |
|--------|---------|
| `DAT_001d8844` | format string `"%08x"` (datadiv-encrypted) |
| `DAT_001d8cbc` | format string `"%02x"` (datadiv-encrypted) |
| `PTR_DAT_001d8010` | RegisterNatives method table (11 methods) |
| `UNK_001c0a60` / `UNK_001c0b90` / `DAT_001c0cc0` | three candidate appSecret blocks |
| `FUN_00108da0` | anti-tamper callback (random 5–15 s delay, then `exit`) |

- **Anti-dump scatter:** `FUN_001162a8` reads the 4 secret words from **non-contiguous** offsets
  (`0`, `0x4C`, `0x98`, `0xE4` = 0, 0x13×4, 0x26×4, 0x39×4) so a linear memory dump doesn't reveal
  the secret in order.
- **OLLVM control-flow flattening:** every function is a `while` state machine driven by a state
  variable compared against magic constants (`0x1855e784`, `0x189fd33e`, …). Read it by **ignoring
  the state-machine skeleton and following only the real child-function calls.**
- **datadiv string encryption:** appkey, appSecret, class/method names, format strings are decrypted
  at runtime; static view shows ciphertext.
- **No `Java_*` exports:** JNI methods are bound via `RegisterNatives` inside `JNI_OnLoad`. Only
  `JNI_OnLoad` appears in Exports.

---

## 4. Reverse-engineering methodology

### Static phase A — jadx (find the call chain)

- Searching string values (`1d8b6e7d45233436`, `sign`, `appSecret`) returns **0 hits** (DEX VMP +
  string encryption). Search the things that **can't** be obfuscated: API URL paths and framework
  method names.
- Trace: URL path `x/v2/reply` → Retrofit `BiliCommentApiService.postComment(@FieldMap Map)`
  (no `sign`/`appkey` in the map) → find usages up to `ServiceGenerator.createService()` →
  `DefaultRequestInterceptor.intercept()` calls `addCommonParam()` (adds `appkey`, etc.) and
  `signQuery()` → `LibBili.signQuery(map)` → `s(new TreeMap(map))` `native` →
  `libbili.so` loaded via `jp4.c.c("bili")`.
- Conclusion: `sign = native s(SortedMap)`; the map is TreeMap-sorted before the JNI call.

### Dynamic phase B — Frida (find the runtime address)

**B0 — bypass anti-Frida** (`scripts/frida/bypass.js`, load first):
`libmsaoaidsec.so` spawns a detection thread via `pthread_create` that scans `/proc/self/maps`
(for `"frida"`), `/proc/self/status` (TracerPid), and `libart.so` pointers. Bypass: hook libc
`dlsym`; when `libmsaoaidsec.so` requests `pthread_create`, return a no-op `NativeCallback`.
**Must use spawn mode** so the hook is in place before `libmsaoaidsec.so`'s `JNI_OnLoad`.

**B1 — locate the native function via RegisterNatives** (`scripts/frida/hook_sign.js`):
No `Java_*` exports exist and `JNI_OnLoad` is an unreadable OLLVM state machine. Insight:
`env->RegisterNatives()` ultimately calls
`art::ClassLinker::RegisterNative(Thread*, ArtMethod*, void* fnPtr)` in `libart.so` (system lib,
unobfuscated), once per method, with `args[3]` = the real `.so` function pointer. The mangled symbol
is `_ZN3art11ClassLinker14RegisterNativeEPNS_6ThreadEPNS_9ArtMethodEPKv`. Hook it, filter `args[3]`
to addresses inside `libbili.so`, record offsets. This captured 11 methods (`+0x8fc4`, `+0x8fd8`,
`+0x8fec`, `+0x9050`, `+0x90ac`, …).

**B1b — confirm which is `sign`:** Elimination by "what fired after my action" **fails** — `sign` is
global, firing on every signed API from app startup. Confirm structurally in Ghidra:
`+0x9050 → FUN_00109050(JNIEnv*, jclass, jobject SortedMap)` matches `LibBili.s(SortedMap)`, and its
chain reaches `MD5_Init/Update/Final`. The others have mismatched params and no MD5 in their chain.

### Static phase C — Ghidra (read the logic)

Follow `+0x9050` inward, ignore the OLLVM skeleton, read the MD5 leaf `FUN_00118ff0`. Two holes
remain: the two encrypted `DAT_` format strings and the appSecret value.

### Dynamic phase D — Frida (fill the encrypted constants)

- **`hook_sprintf.js`** — hook libc `sprintf`, print only calls whose return address is inside
  `libbili.so`. After an action: `caller=+0x190dc fmt="%08x"` (×4) and `caller=+0x192a0 fmt="%02x"`
  (×16) — confirming the two `DAT_` format strings.
- **`scripts/frida/hook_appsecret.js`** — attach `FUN_00118ff0` (`libbiliBase + 0x18ff0`); in
  `onEnter` read `args[3]` as 4 uint32 → `560c52ccd288fed045859ed18bffd973`.

### Verification phase E — Python

Reimplement `make_sign()`; computed sign equals captured sign → algorithm confirmed
(`scripts/bili_sign.py`).

---

## 5. Gotchas

1. **Spawn mode uses the package name** (`tv.danmaku.bili`); attach mode uses the display name
   (the localized `Bilibili` app label). Don't mix them.
2. **Never `Java.use().implementation = ...`** — mutating the ART method table is detected; the app
   dies in ~3 s. Pure native `Interceptor.attach` only.
3. **`RegisterNatives` is not the export name** — use the mangled
   `_ZN3art11ClassLinker14RegisterNativeEPNS_6ThreadEPNS_9ArtMethodEPKv`.
4. **Ghidra base `0x100000`** — file offset = Ghidra addr − `0x100000`.
5. **Values MUST be URL-encoded before signing** — this was the last bug; raw values give a wrong
   sign.
6. **Global functions can't be isolated by elimination** — confirm via Ghidra param/call-chain.
7. **The secret words are scattered** (offsets 0, 0x4C, 0x98, 0xE4) — a contiguous dump won't show
   them in order.
8. **Strings are absent statically** — search URL paths and framework method names, not literals.
