---
name: capa-triage
description: Use capa (Mandiant) + FLOSS to perform capability triage and string deobfuscation on native libraries (.so / ELF) and executables—before diving into IDA/Ghidra decompilation, automatically identify what capabilities a binary has (crypto/network/anti-debug/anti-analysis/file operations) and recover obfuscated/encoded/stack-built strings (URLs, keys, C2). Trigger scenarios — capa, floss, analyze .so capabilities, identify crypto algorithms, native library capability overview, deobfuscate strings, triage before digging deep.
---

# capa + FLOSS Native Capability Triage

Both `capa` and `floss` are installed globally (`capa` and `floss` are on PATH). This is the **first quick triage step** for analyzing an unfamiliar `.so`—spend a few seconds to learn "roughly what this library does + what suspicious strings it contains," then decide where IDA/Ghidra should focus.

## capa — Capability Identification
```bash
# Run capability identification on a .so (ARM/ARM64 ELF), output a human-readable report
capa <path/to/lib.so>
# Structured JSON (suitable for agent parsing/post-processing)
capa -j <path/to/lib.so> > capa.json
# Show only the addresses where each capability hits, for easy IDA/Ghidra localization
capa -v <path/to/lib.so>
```
The output lists capabilities by ATT&CK / MBC category: crypto (AES/RC4/base64), network communication, anti-debug/anti-VM, file/registry operations, process injection, and so on, along with the hit addresses.

## FLOSS — String Deobfuscation
```bash
# Recover static strings + stack strings + encoded/decoded strings
floss <path/to/lib.so>
# Static + stack strings only (faster)
floss --no-decoded-strings <path/to/lib.so>
# JSON output
floss -j <path/to/lib.so> > floss.json
```
Note: FLOSS supports stack strings and encoded strings for ELF/.so, but **language-aware extraction (Go/Rust) is only complete for PE**; fidelity on ELF is lower than on PE—treat the decoded strings you get as leads, not as the sole basis.

## Standard usage (triage flow)
1. `capa -v lib.so` → check whether there are crypto / anti-debug / network hits, note the addresses
2. `floss lib.so` → scoop up URLs, domains, suspicious constants, key material
3. Take the "addresses + strings" from the two steps above into [[ida-reverse-engineering]] / [[ghidra-reverse-engineering]] to closely read the corresponding functions
4. If crypto is hit, pair with [[frida-hooking]] to hook these addresses at runtime and verify plaintext→ciphertext

## Connecting with other skills
- Source of the .so: first [[apktool-decompile]] to unpack, then grab the target .so from `lib/arm64-v8a/`
- When capa hits anti-debug/anti-frida, it means you need [[unidbg-emulation]] to run it offline or device-side anti-detection
