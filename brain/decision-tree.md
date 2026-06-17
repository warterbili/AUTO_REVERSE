# Decision Tree: Fingerprint → Analysis Chain

After the brain obtains `fingerprint.json` in Phase 1, it uses this table to route the target to a specific playbook and skill sequence. **Match top-down and take the first rule that hits.**

## Android

```
Is it packed? (Application=stub / tiny dex / matches a known packer .so)
├─ Yes → [unpack] android-unpacking → return to Phase 1 and re-fingerprint
└─ No ↓

Framework? (scan lib/<abi>/)
├─ libflutter.so + libapp.so      → playbook: android-flutter   (reFlutter/blutter; jadx is useless)
├─ libhermes.so + *.bundle         → playbook: android-rn-hermes (hermes-dec)
├─ libil2cpp.so                    → playbook: android-unity     (frida-il2cpp-bridge)
└─ Only classes.dex (native)       ↓

Where is the core logic? (statically scan signing/encryption call sites)
├─ Pure Java/Kotlin (no native calls)    → playbook: android-java-sign   (jadx → hook to confirm → reproduce)
└─ Calls native (System.loadLibrary + JNI) → playbook: android-native-sign (jadx locates the boundary → capa → ghidra → unidbg)

Stacked protections (orthogonal to the above — add them on when hit):
├─ SSL pinning (OkHttp/NSC)  → dynamic bypass via frida-mitm-capture; or static apk-mitm
├─ RASP (root/frida/ptrace detection) → device-side Shamiko/vector + objection root disable; stealth injection via ZygiskFrida
└─ Heavy obfuscation (R8/control flow) → android-re-decompile name recovery; deflat for native flattening
```

## Web

```
Any bot protection? (PerimeterX/Akamai/Cloudflare signatures)
├─ Yes → prefer cdp-browser (real Chrome, no webdriver fingerprint); route specialized shells to the matching skill (e.g. px-reverse)
└─ No → web-api-analyzer to capture a HAR is enough ↓

Do requests carry signature/encrypted parameters?
├─ Yes → cdp-browser injects a hook to locate the signing/encryption function → reconstruct the algorithm → reproduce
└─ No → just compile the endpoint list + auth method
```

## Windows (roadmap, not yet implemented)
```
DIE identifies language/packer → .NET? dnSpy/ILSpy ; native? Ghidra/x64dbg ; packed? unpack first
```

## Escalation Criteria (feedback-loop triggers)
- Static analysis finds an encrypted field but can't locate its plaintext source → escalate to Dynamic (hook).
- Dynamic analysis shows the signature is computed in native code → escalate to Native (capa → ghidra → unidbg).
- The native algorithm contains device-dependent callbacks and needs batch reproduction → patch the unidbg environment (jni-env-patching).
