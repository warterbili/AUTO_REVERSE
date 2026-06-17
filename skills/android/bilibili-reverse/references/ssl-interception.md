# Bilibili SSL Plaintext Interception — Methodology

The foundation of all Bilibili Android capture: read TLS plaintext (comment body, `sign`,
`access_key`, gRPC frames) at the **native** layer by hooking `SSL_write` / `SSL_read`. This beats
every proxy because Bilibili's network stack ignores the system proxy and bundles its own BoringSSL.

---

## 1. Why plaintext beats proxies

1. **`libignet.so` ignores the system proxy.** It's a ~5.4 MB self-built C++ network stack (bundling
   gRPC-core ≈3 MB + Protobuf ≈1 MB + BoringSSL ≈1.5 MB) opening raw sockets. Charles' proxy only
   affects the Java/OkHttp path.
2. **Bilibili bundles its own BoringSSL** (separate from system Conscrypt), enabling lower-level cert
   pinning that's harder to bypass than Java-layer pinning.
3. **gRPC + HTTP/2** breaks Charles regardless.

Hooking `SSL_write` / `SSL_read` sits below all of this — it captures the plaintext buffer right
before encryption / right after decryption, for any protocol (REST / HTTP-2 / gRPC) and any domain.
It is also invisible to the ART method-table scan because it's a native `Interceptor.attach`, not a
`Java.perform`.

---

## 2. The two `libssl.so` problem (key discovery)

Bilibili has **two** TLS libraries; both must be hooked.

| Library | Path | Used by |
|---------|------|---------|
| System Conscrypt | `/apex/com.android.conscrypt/lib64/libssl.so` | OkHttp (REST: home, search, video info) |
| **Bundled BoringSSL** | `/data/app/.../tv.danmaku.bili-.../lib/arm64/libssl.so` (~396 KB) | `libignet.so` (comment send, gRPC, P2P CDN) |

**Lazy-loading gotcha:** the bundled `libssl.so` is **not** loaded at startup — `libignet.so`
`dlopen`s it only on the *first* network request. Enumerating at injection time finds only Conscrypt.
**Solution:** poll with `setInterval` (every 500 ms, ×20 = 10 s) and hook any new `libssl.so` as it
appears.

### How the bundled lib was found

- `find_ssl.js` enumerated modules for `SSL_write`/`SSL_read`/`_ex` — initially only Conscrypt.
- After opening a video (forcing a gRPC/TLS connection), `Process.enumerateModules()` revealed the
  second `libssl.so` under the app dir plus the 5.4 MB `libignet.so`.
- Confirmed `libignet.so` via `enumerateExports()` (`grpc_*`, `SSL_*`, `protobuf_*`, `bilibili_*`),
  `strings | grep grpc\|biliapi\|service_comment`, and `readelf -d | grep NEEDED` (depends on the
  bundled `libssl.so`).

---

## 3. Anti-Frida bypass (`scripts/frida/bypass.js`)

Bilibili's anti-Frida (v7.76.0+) lives in `libmsaoaidsec.so`: it `dlsym`s `pthread_create` then
spawns a detection thread that scans `/proc/self/maps` (for `"frida"`), `/proc/self/status`
(TracerPid), and `libart.so` pointers.

**bypass.js approach:** hook `dlsym`; when the caller module is `libmsaoaidsec.so` and the requested
symbol is `pthread_create`/`pthread_join`, return a fake no-op `NativeCallback` so the detection
thread never starts.

Critical detail:

```javascript
// Module.findExportByName() returns a PLT stub that CANNOT be hooked.
// Use enumerateExports() to get dlsym's REAL address.
function findDlsymReal() {
    var libdl = Process.findModuleByName("libdl.so");
    var addr = null;
    libdl.enumerateExports().forEach(function (e) { if (e.name === "dlsym") addr = e.address; });
    return addr;
}
```

On `dlsym` `onLeave`, if `this.symbol` ∈ {`pthread_create`,`pthread_join`} and
`Process.findModuleByAddress(this.returnAddress).name` contains `msaoaidsec`, `retval.replace(fake)`.

### Deprecated bypass attempts (lessons)

- **"Blinding" strategy** (let the thread run, hook `strstr`/`connect`/`open`+`read` to hide frida)
  → **SIGSEGV.** `read` is called by every thread for many purposes; overwriting kernel-provided
  buffers (e.g. `perfetto_hprof_` heap-dump reads into protected memory) faults. **Lesson: the lower
  the hooked function, the more side effects.**
- **`find_registernatives.js`** — diagnostic to recover `RegisterNatives`-registered native method
  symbols (used to locate the right functions to hook).
- **`debug_pthread.js`** — traced `pthread_create` callers to *prove* bypass.js worked, isolating the
  real crash to `Java.perform`'s ART-table modification.

---

## 4. Native SSL hook implementation (`scripts/frida/ssl_hook.js`)

Per-`libssl.so`:

- `SSL_write` (onEnter): `len = args[2].toInt32()`; skip if `len <= 0 || len > 131072`; log plaintext
  at `args[1]`.
- `SSL_read` (onLeave): real length = return value; buffer captured in onEnter
  (`args[0]`=ssl, `args[1]`=buf).
- `SSL_set_tlsext_host_name` (onEnter): record SNI per ssl-pointer for host attribution.
- `SSL_get_servername`: fallback host lookup.

### Frame parsing

- Detects HTTP/1.1 text (`POST`/`GET `/`HTTP` prefix) vs HTTP/2 (skip the 24-byte
  `PRI * HTTP/2.0...` preface), then walks 9-byte HTTP/2 frame headers (len/type/flags/stream-id),
  processing only DATA frames (type `0x00`).
- Distinguishes gRPC uncompressed (gc=0) / gRPC gzip (gc=1) / plain REST body (first byte `0x1f`).
- **gzip inflate gotcha:** `inflateInit2_`'s 4th arg must equal `sizeof(z_stream)` = **112 bytes on
  ARM64 Android** (not 128). Passing 128 → `Z_VERSION_ERROR (-6)` and silent failure despite valid
  `1f 8b` magic. ARM64 `z_stream` offsets: `next_in@0, avail_in@8, total_in@16, next_out@24,
  avail_out@32, total_out@40`; use `wbits = 47` (15 + 32) for gzip mode.

> The HPACK header decode (for capturing request headers) needs all three layers — static table (61
> entries), RFC 7541 Huffman, and the per-connection dynamic table — and only fully accumulates in
> spawn mode. That logic is large; the request/response **bodies** (what you need for `sign`) come
> straight out of `SSL_write`/`SSL_read` and don't require HPACK.

---

## 5. Reusable step-by-step method

1. Frida server on device (`/data/local/tmp/frida-server`), `frida-tools` on PC.
2. Spawn with bypass first:
   `frida -U -f tv.danmaku.bili -l scripts/frida/bypass.js -l scripts/frida/ssl_hook.js`.
   Spawn mode (`-f`) ensures hooks are ready before any app code runs → all frames captured.
3. bypass.js neutralizes `libmsaoaidsec.so`. **Do not use `Java.perform`** — ART scan kills the
   process in ~3 s.
4. Hook **both** `libssl.so` instances; poll (500 ms ×20) for the lazily-loaded bundled BoringSSL.
5. In `SSL_write`/`SSL_read`: capture plaintext, parse HTTP/2 frames, handle gzip
   (z_stream size = **112**), decode Protobuf (gRPC) or form-urlencoded (REST).
6. Trigger the target action; wait for both libssl hooks confirmed first.
7. Sanity banner: expect `SSL_write in libssl.so (...conscrypt...)` then later
   `(...tv.danmaku.bili-.../lib/arm64)`.
