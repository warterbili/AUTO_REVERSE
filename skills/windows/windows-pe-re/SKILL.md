---
name: windows-pe-re
description: Windows PE reverse-engineering automation skill (.exe/.dll/.sys). Fingerprint/packer-and-language detection → route by type (.NET decompile / native decompile / unpack) → dynamic debugging → deobfuscation → capability triage, using Windows tools from the catalog throughout (fetch on demand if missing). Trigger scenarios — reverse a Windows program, analyze exe/dll, PE unpacking, .NET decompilation, packer detection, x64dbg debugging, malware sample analysis.
---

# Windows PE Reverse-Engineering Automation

Proceed through the flow below; pick tools from `catalog/windows.yaml` + `catalog/native.yaml`, and for missing ones use `python tools/fetch.py <id>` (installs into the project). **Fingerprint first, then route by type—don't decompile blindly.**

## Phase 1 — Fingerprint / packer detection (mandatory first step)
Use **Detect It Easy** (`detect-it-easy`) to determine: format, **language** (.NET vs native C/C++ vs Go/Rust), **packer/protector** (UPX/Themida/VMProtect/...), and entropy.
```bash
diec --json target.exe        # JSON output for the brain to route on
```
- Known packer hit → do **Phase 2 unpacking** first, then return to this phase and re-fingerprint.
- .NET → **Phase 3a**; unpacked native → **Phase 3b**.

## Phase 2 — Unpacking (only when a packer is hit)
- **UPX** and other standard packers: `upx -d`.
- **Themida / VMProtect / custom packers**: use x64dbg (`x64dbg`) to manually run to the OEP → **Scylla** (`scylla`) to rebuild the IAT and export a runnable PE; use **ScyllaHide** (`scyllahide`) to defeat anti-debugging.
- **Already unpacked in memory / process injection**: **PE-sieve** (`pe-sieve`) to dump the unpacked module from a live process (`pe-sieve /pid <pid> /dump`).
- VM-protection devirtualization (advanced): **Mergen** (`mergen`) / **NoVmp** (`novmp`).
→ After unpacking, return to Phase 1 and re-fingerprint.

## Phase 3a — .NET route
- Decompile + debug + edit: **dnSpyEx** (`dnspyex`). For obfuscation (ConfuserEx etc.), first clean with **de4dot-cex** (`de4dot`), then feed into dnSpyEx.
- Cross-platform/batch: **ILSpy**'s `ilspycmd`.

## Phase 3b — native route
- Static decompilation: **Ghidra** (`ghidra-reverse-engineering`) the free workhorse / **IDA** (`ida-reverse-engineering`) if licensed / **Binary Ninja** (`binary-ninja`).
- Capability triage: **capa** (`capa-triage`) to first tag crypto/anti-debug/network + addresses, then enter the decompiler with those addresses.
- PE header/import-table surgery and resource viewing: **PE-bear** (`pe-bear`).

## Phase 4 — Dynamic debugging
- User mode: **x64dbg** (`x64dbg`) for breakpoints/single-step/memory editing/pattern scanning; if the sample detects a debugger, attach **ScyllaHide/TitanHide**.
- Crash dumps / kernel: **WinDbg** (`windbg`), `!analyze -v`; for AI-driven use, pair with **mcp-windbg** (`catalog/mcp.yaml`).

## Phase 5 — Deobfuscation (as needed)
- Control-flow flattening / MBA / opaque predicates (IDA microcode layer): **D-810-ng** (`d810-ng`) + **gooMBA** (`goomba`).
- String decryption: **FLOSS** (`capa-triage`); for ARM/custom decryptors use **flare-emu** (`flare-emu`).

## Connecting
- For malware that needs dynamic unpacking + config extraction → **CAPEv2** (`capev2`) sandbox.
- To let AI drive the debugger/decompiler directly → see `catalog/mcp.yaml` (mcp-windbg / x64dbg-mcp / binary-ninja-mcp / re-mcp).

## Notes
- Most tools in this skill are Windows-native (some run under Wine); on non-Windows hosts, prefer cross-platform options like Ghidra/r2/capa.
- Commercial options (IDA/Binary Ninja/Hopper) are optional—don't insist on them without a license; do not use pirated software.
