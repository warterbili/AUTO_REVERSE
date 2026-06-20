---
name: capa-triage
description: Use capa (Mandiant) + FLOSS to perform capability triage and string deobfuscation on native libraries (.so / ELF) and executables—before diving into IDA/Ghidra decompilation, automatically identify what capabilities a binary has (crypto/network/anti-debug/anti-analysis/file operations) and recover obfuscated/encoded/stack-built strings (URLs, keys, C2). Trigger scenarios — capa, floss, analyze .so capabilities, identify crypto algorithms, native library capability overview, deobfuscate strings, triage before digging deep.
---

# capa + FLOSS Native Capability Triage

This is a **first quick triage step** for an unfamiliar `.so`—learn "roughly what this library does + what suspicious strings it contains," then decide where IDA/Ghidra should focus.

> [!IMPORTANT]
> **Prerequisites & platform reality (read before running on an Android `.so`):**
> - **capa needs a rule set.** `pip install capa` (how `fetch.py` installs it) does **not**
>   embed rules — a bare `capa lib.so` errors with *"default embedded rules not found"*.
>   Provision them once: `python tools/fetch.py capa-rules` → then pass `-r tools/bin/capa-rules`.
>   Use the rules tag that matches your capa version (`capa --version`).
> - **aarch64 needs a non-default backend.** capa's default **vivisect** backend does not
>   disassemble ARM64. For an Android arm64 `.so` use `--backend ghidra` (needs Ghidra on
>   PATH) or feed a BinExport2 (`-f binexport2`). x86/x64 ELF works with the default backend.
> - **FLOSS does NOT support ELF/.so.** As of FLOSS 9.x it analyses **PE and shellcode only**
>   (`floss lib.so` → *"FLOSS currently supports the following formats … PE"*). For strings on
>   an Android `.so`, use Ghidra/IDA, `rabin2 -zz` (radare2), or plain `strings` — not FLOSS.
>
> Net: for Android arm64, capa (with rules + `--backend ghidra`) gives a capability map, but
> often it's faster to go straight to [[ghidra-reverse-engineering]]. FLOSS is for PE malware.

## capa — Capability Identification
```bash
# x86/x64 ELF (default backend is fine):
capa -r tools/bin/capa-rules <path/to/lib.so>
# Android arm64 .so — default vivisect backend can't disassemble ARM64, use Ghidra:
capa -r tools/bin/capa-rules --backend ghidra <path/to/lib.so>
# Structured JSON (suitable for agent parsing/post-processing):
capa -r tools/bin/capa-rules -j <path/to/lib.so> > capa.json
# Show only the addresses where each capability hits, for easy IDA/Ghidra localization:
capa -r tools/bin/capa-rules -v <path/to/lib.so>
```
The output lists capabilities by ATT&CK / MBC category: crypto (AES/RC4/base64), network communication, anti-debug/anti-VM, file/registry operations, process injection, and so on, along with the hit addresses.

## FLOSS — String Deobfuscation (PE / shellcode only — NOT Android `.so`)
FLOSS 9.x **rejects ELF outright** (`floss lib.so` → *"FLOSS currently supports the following
formats … PE"*). Use it only on Windows PE malware or raw shellcode:
```bash
floss <sample.exe>                       # static + stack + decoded strings (PE)
floss --format sc64 <shellcode.bin>      # raw shellcode
```
For strings on an **Android `.so`**, use one of these instead:
```bash
strings -n 6 lib.so                       # quick plaintext
rabin2 -zz lib.so                         # radare2: all strings incl. data sections
# or read them in Ghidra/IDA (best for stack-built / decrypted-at-runtime strings)
```

## Standard usage (triage flow)
1. `capa -r tools/bin/capa-rules --backend ghidra -v lib.so` → crypto / anti-debug / network hits + addresses (drop `--backend ghidra` for x86/x64)
2. `strings -n 6 lib.so` / `rabin2 -zz lib.so` → scoop up URLs, domains, suspicious constants, key material (FLOSS is PE-only — see above)
3. Take the "addresses + strings" from the two steps above into [[ida-reverse-engineering]] / [[ghidra-reverse-engineering]] to closely read the corresponding functions
4. If crypto is hit, pair with [[frida-hooking]] to hook these addresses at runtime and verify plaintext→ciphertext

## Connecting with other skills
- Source of the .so: first [[apktool-decompile]] to unpack, then grab the target .so from `lib/arm64-v8a/`
- When capa hits anti-debug/anti-frida, it means you need [[unidbg-emulation]] to run it offline or device-side anti-detection
