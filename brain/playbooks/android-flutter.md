# Playbook: android-flutter
# Applies to: Flutter apps — lib/<abi>/libflutter.so (the engine) + libapp.so (compiled Dart AOT snapshot).
# Key fact: jadx is USELESS here — business logic & API code are in libapp.so (Dart), not in classes.dex. SSL pinning lives in BoringSSL inside libflutter.so, NOT in OkHttp/NetworkSecurityConfig.

## Goal
Recover the Dart-level logic (API endpoints, signing) from libapp.so, and capture HTTPS traffic that ordinary OkHttp-layer interceptors cannot see.

## Steps (the brain executes in order; each step emits a findings.json)

1. **Unpack + fingerprint** (skill: apktool-decompile / android-re-decompile)
   - Confirm Flutter: `lib/<abi>/libflutter.so` + `libapp.so` present; dex is a thin host
   - Note the abi, and read libflutter.so build info (the Dart/Flutter version drives every downstream tool)
   - Output: is_flutter, abi, flutter_version_hint

2. **Identify the Dart snapshot version** (catalog: blutter)
   - blutter auto-detects the Dart version from libflutter.so; if it can't, match the engine commit → Dart version manually
   - Output: dart_version, snapshot_kind (AOT)

3. **Recover Dart symbols/structure** (catalog: blutter — preferred; reflutter — alternative)
   - blutter parses libapp.so → emits recovered object/function info + an IDA/Ghidra script + a frida hook template (`blutter_frida.dart.js`)
   - For dynamic class/method dumping or when blutter fails on a version, use reflutter (patches the engine, repackages the APK, dumps Dart classes/methods at runtime and reroutes traffic through a proxy)
   - Output: dart_symbols, candidate_api_methods[], frida_hook_template

4. **Capture traffic at the Flutter/BoringSSL layer** (catalog: reflutter; skill: frida-mitm-capture as fallback)
   - reFlutter repackaged build routes HTTPS through your proxy (it patches Flutter's BoringSSL verification) → read endpoints/params directly
   - If not repackaging: frida-mitm-capture with a BoringSSL `ssl_verify`/`SSL_CTX_set_custom_verify` bypass (hook in libflutter.so by pattern, NOT the Java OkHttp hooks — those see nothing here)
   - Output: endpoints[], request_params[], signature_fields[]

5. **Reverse the signing logic, if any** (catalog: blutter output → skill: ghidra-reverse-engineering; skill: frida-hooking on the Dart fn)
   - Use blutter's symbol script in Ghidra to read the signing function; hook the recovered Dart function with the blutter frida template to confirm in→out
   - Reproduce offline and validate against captured samples
   - Output: algorithm, reproducer

6. **Synthesize + verify** (the brain)

## Common Blockers → Countermeasures
- blutter fails / Dart version unsupported → fall back to reflutter (runtime dump) or pin an older blutter commit matching the Dart version
- Traffic still invisible after Java SSL bypass → you hooked the wrong layer; pinning is in libflutter.so BoringSSL — bypass there (reFlutter repack is the reliable route)
- Stripped/obfuscated snapshot → blutter still recovers structure from the snapshot format; lean on runtime frida hooks for the few functions you need
- Split ABIs / app bundle → make sure you pulled the libapp.so for the device's actual abi
