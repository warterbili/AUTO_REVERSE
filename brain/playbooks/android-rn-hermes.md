# Playbook: android-rn-hermes
# Applies to: React Native apps. Two sub-shapes:
#   (A) Hermes engine — lib/<abi>/libhermes.so + assets/index.android.bundle as Hermes BYTECODE (HBC, magic 0x1F1903C1)
#   (B) Classic JSC — index.android.bundle is plain (minified) JavaScript
# Key fact: business logic & API code live in the JS bundle, not in classes.dex. jadx only shows the RN host shell.

## Goal
Recover the JS/business logic from index.android.bundle (decompile Hermes bytecode or beautify plain JS), extract API endpoints + signing, and reproduce.

## Steps (the brain executes in order; each step emits a findings.json)

1. **Unpack + fingerprint** (skill: apktool-decompile / android-re-decompile)
   - Pull `assets/index.android.bundle`; check first bytes:
     - Hermes if magic `0x1F1903C1` (and libhermes.so present) → path A
     - else readable/minified JS → path B (JSC)
   - Note the Hermes version (HBC header) — it drives the decompiler choice
   - Output: rn_kind (hermes|jsc), hermes_bytecode_version

2A. **Decompile Hermes bytecode** (catalog: hermes-dec — preferred; hbctool — disasm/patch; hermes-decomp / hermes-rs — alternatives)
   - **Fast recon first**: `python tools/hermes_strings.py <apk|bundle> --grep 'hmac|signature|bearer|api\.|x-'`
     dumps the real string table one-per-line (plain `strings` fails — Hermes concatenates the table).
     API hosts, header names, auth scheme, and crypto hints surface here in seconds.
   - hermes-dec disassembles + pseudo-decompiles the HBC across a wide version range → readable JS-like output
   - If hermes-dec can't match the version, hbctool disassembles to assembly (and can reassemble/patch the bundle)
   - Output: decompiled_js, string_table (API hosts, keys often appear here)

2B. **Beautify plain JS** (skill: web-api-analyzer style; catalog: webcrack)
   - Prettify/unminify the bundle; webcrack can unbundle webpack-style modules and deobfuscate
   - Output: beautified_js, modules[]

3. **Locate API + signing in the JS** (the brain + grep over decompiled output)
   - Search the recovered JS for `fetch(`/`XMLHttpRequest`/axios, header names, `sign`/`hmac`/`md5`/`encrypt`, base URLs
   - Output: endpoints[], request_params[], signing_fn_location, candidate_constants[]

4. **Confirm at runtime** (skill: frida-hooking + frida-mitm-capture + objection-runtime)
   - frida-mitm-capture for plaintext traffic (RN uses OkHttp under the hood on Android, so standard SSL bypass + okhttp hooks usually WORK here — unlike Flutter)
   - frida-hooking: hook the Hermes function (by the offset hermes-dec gives) or the JS bridge to confirm signing in→out
   - Output: crypto_io[] samples

5. **Reproduce offline** (the brain)
   - Re-implement the signing in Python/JS; validate against step-4 samples
   - Output: algorithm, reproducer

6. **Synthesize + verify** (the brain)

## Common Blockers → Countermeasures
- hermes-dec output is partial / version mismatch → use hbctool to disassemble, or pin the hermes-dec release matching the HBC version; identify version from the bundle header
- Bundle is split / loaded from multiple files or downloaded at runtime → pull the actual bundle from the device's data dir after first launch (frida dump)
- Strings encrypted in-bundle → confirm the decryptor at runtime via frida hook rather than static recovery
- Plain-JS path with heavy obfuscation (control-flow flattening, string arrays) → catalog: webcrack / AST deobfuscators before reading
