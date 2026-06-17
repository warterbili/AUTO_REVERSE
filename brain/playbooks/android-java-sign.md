# Playbook: android-java-sign
# Applies to: native Android apps whose requests carry signature/encrypted params, where the signature is computed entirely in Java/Kotlin (no System.loadLibrary / JNI on the signing path).
# This is the MOST COMMON shape — try this before assuming native. If the signing call crosses into a .so, switch to android-native-sign.

## Goal
Figure out how a request's signature/encrypted field is computed in Java/Kotlin, and reproduce it offline in Python/JS.

## Steps (the brain executes in order; each step emits a findings.json)

1. **Unpack + fingerprint** (skill: apktool-decompile / android-re-decompile)
   - apktool unpacks; read the manifest (package, entry point, networkSecurityConfig)
   - Scan `lib/<abi>/`: confirm there is NO custom signing .so on the request path (only stdlib/3rd-party) → Java path confirmed
   - If a suspicious .so is loaded on the signing path → STOP, switch to android-native-sign

2. **Statically locate the signing call site** (skill: jadx-reverse-engineering / android-re-decompile)
   - jadx decompile; search OkHttp `Interceptor` / `addHeader` / `sign` / `encrypt` / `MessageDigest` / `Mac` / `Cipher` / `Base64`
   - Trace the header value back to its producer method; note class + method
   - For R8/Proguard obfuscation → android-re-decompile name recovery; for string encryption → deob the constant pool
   - Output: crypto_sites[], signing_method, candidate_constants[] (keys/salts/HMAC secrets seen in code)

3. **Dynamically confirm in/out** (skill: frida-mitm-capture + frida-hooking + objection-runtime)
   - objection `sslpinning disable` + `root disable`; ensure frida-server runs
   - frida-mitm-capture captures the plaintext request for one operation → record the real signature value
   - frida-hooking hooks the signing method from step 2: dump arguments → return value (plaintext → signature), and hook the underlying `Mac/MessageDigest/Cipher.doFinal` to grab the actual key/IV/algorithm
   - Output: crypto_io[] (≥3 plaintext→signature samples), confirmed_key, confirmed_algo

4. **Reproduce offline** (the brain)
   - Rewrite the algorithm in Python/JS using the confirmed key/algo/field-order
   - Validate the reproducer reproduces the step-3 samples byte-for-byte
   - Output: algorithm (pseudocode + constants), reproducer script

5. **Synthesize + verify** (the brain)
   - Report: field root cause + reproduction script; independently build a working request

## Common Blockers → Countermeasures
- Heavy control-flow obfuscation / reflection hides the call → hook broadly at `Mac.update/doFinal`, `MessageDigest.update`, `Cipher.doFinal` to catch the real input/key regardless of wrapper code
- Signature includes timestamp/nonce/device-id → capture several sample sets to identify which terms are dynamic; pull device-id source from the hook
- Key is assembled at runtime / fetched from server → the step-3 hook on `Mac.init(key)` reveals the final key bytes; no need to reverse the assembly
- The "Java" method actually delegates to a .so → escalate to android-native-sign
