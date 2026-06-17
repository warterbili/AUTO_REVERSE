# Playbook: windows-pe
# Applies to: Windows PE targets (.exe/.dll/.sys). Corresponding skill: windows-pe-re.

## Goal
Understand a Windows program's logic/algorithm, or unpack it to obtain a clean, analyzable PE.

## Steps (the brain proceeds in order; each step emits a findings.json)

1. **Fingerprint / packer detection** (DIE `diec --json`) → format, language (.NET/native/Go), packer, entropy
   - Packer hit → step 2; .NET → step 3a; unpacked native → step 3b
2. **Unpack**: UPX → `upx -d`; Themida/VMP → run to OEP in x64dbg + rebuild the IAT with Scylla (ScyllaHide defeats anti-debug); in-memory unpacking → PE-sieve dump → return to step 1
3a. **.NET**: de4dot-cex to deobfuscate → dnSpyEx to decompile/debug/edit
3b. **native**: capa capability triage (note addresses) → Ghidra/IDA/BinaryNinja decompile → close reading of the key functions
4. **Dynamic** (when needed): set breakpoints / trace in x64dbg; analyze crash dumps with WinDbg `!analyze -v`
5. **Deobfuscation** (when applicable): D-810-ng + gooMBA (IDA microcode); strings via FLOSS/flare-emu
6. **Synthesize**: produce the report + reproduction/PoC

## Escalation Criteria
- Static analysis is unclear but runtime behavior is clear → dynamic x64dbg trace
- VM protection (VMP/Themida) → devirtualize with Mergen/NoVmp
- Malware sample requires config extraction → CAPEv2 sandbox

## Common Blockers
- Anti-debug alters behavior → ScyllaHide (user mode) / TitanHide (kernel)
- Corrupted IAT prevents the program from running → rebuild with Scylla
- No license for a commercial decompiler → use Ghidra throughout (free, cross-platform)
