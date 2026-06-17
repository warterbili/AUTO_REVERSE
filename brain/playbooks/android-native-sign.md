# Playbook: android-native-sign
# Applies to: native Android apps whose requests carry signature/encrypted parameters, where the signature is computed in native code (.so).
# This is the most common shape for fintech/risk-control apps (DailyPay most likely falls into this category).

## Goal
Figure out how a request's signature/encrypted field is computed, and be able to reproduce it offline/independently.

## Steps (the brain executes in order; each step emits a findings.json)

1. **Unpack + fingerprint** (skill: apktool-decompile / android-re-decompile)
   - apktool unpacks; read the manifest (package name, entry point, networkSecurityConfig)
   - Scan `lib/arm64-v8a/`, confirm it's native and has a custom .so (the signing library)
   - Note the suspicious .so name(s)

2. **Statically locate the signing call site** (skill: jadx-reverse-engineering / android-re-decompile)
   - jadx decompile; search for OkHttp Interceptor / addHeader / sign / encrypt / `System.loadLibrary`
   - Find the Java→native boundary method (the native declaration); note the class name + method name
   - For R8 obfuscation, use android-re-decompile's name recovery
   - Output: crypto_sites[], native_boundary[]

3. **Dynamically confirm parameters** (skill: frida-mitm-capture + objection-runtime)
   - Ensure frida-server is running; objection `sslpinning disable` + `root disable`
   - frida-mitm-capture captures the plaintext request for "login / some operation" → obtain the real signature field value
   - frida-hooking hooks the native boundary method from step 2, dumping inputs → return value (plaintext → signature)
   - Output: confirmed_params[], crypto_io[] (multiple plaintext → signature samples)

4. **Extract the native algorithm** (skill: capa-triage → ghidra-reverse-engineering → unidbg-emulation + jni-env-patching)
   - capa triages the signing .so: is it HMAC/AES/MD5/custom? Note the hit addresses
   - ghidra decompiles the boundary function + RegisterNatives to read the algorithm; use deflat for OLLVM flattening
   - unidbg runs the function offline to reproduce the signature; fill missing JNI callbacks with jni-env-patching
   - Validate that the unidbg output matches the plaintext → signature samples from step 3
   - Output: algorithm (pseudocode/constants/salt), reproducer

5. **Synthesize + verify** (the brain)
   - Produce the report: root cause of the field + reproduction script
   - Independently construct a working request

## Common Blockers → Countermeasures
- App detects frida and crashes → device-side Shamiko/vector already installed; if that's not enough, use ZygiskFrida for stealth injection
- unidbg hangs on threads / deadlocks on PNG decoding, or SDK>23 is incompatible → fall back to pure Frida on-device hooking to extract the algorithm
- Signature contains a timestamp/nonce → capture several more sample sets to cross-check and identify which terms are dynamic
