# Playbook: android-unity
# Applies to: Unity (IL2CPP) games/apps — lib/<abi>/libil2cpp.so + assets/bin/Data/Managed/Metadata/global-metadata.dat.
# Key fact: C# is compiled to native via IL2CPP; symbols are stripped but recoverable from global-metadata.dat. jadx is useless. (Rare Mono builds keep Assembly-CSharp.dll → use dnSpy instead; see Blockers.)

## Goal
Restore C# class/method symbols from the IL2CPP build, then read or hook the signing/API logic and reproduce it.

## Steps (the brain executes in order; each step emits a findings.json)

1. **Unpack + fingerprint** (skill: apktool-decompile / android-re-decompile)
   - Confirm IL2CPP: `libil2cpp.so` + `global-metadata.dat` present
   - If instead `assets/bin/Data/Managed/Assembly-CSharp.dll` exists → Mono build → STOP, decompile the DLL with dnSpy/ILSpy (catalog: dnspy-mcp / RePythonNET-MCP)
   - Note unity_version (drives Il2CppDumper compatibility); check whether global-metadata.dat is encrypted (bad/zero header magic)
   - Output: is_il2cpp, unity_version, metadata_encrypted?

2. **Restore symbols statically** (catalog: il2cppdumper)
   - Il2CppDumper consumes libil2cpp.so + global-metadata.dat → emits C# stub headers (types/methods/fields) + IDA/Ghidra symbol scripts (`ida_with_struct_py3.py` / `ghidra.py`) + `script.json`
   - Load the script in Ghidra/IDA to get named functions
   - Output: csharp_types[], method_map (name→va), symbol_script

3. **If metadata is encrypted / dumper fails — dump at runtime** (catalog: zygisk-il2cppdumper — preferred; frida-il2cppdumper-immy)
   - Zygisk-Il2CppDumper dumps the decrypted metadata + dump.cs from memory at runtime (handles packed/encrypted global-metadata.dat, NetEase-style protections)
   - Re-run step 2 against the dumped metadata if needed
   - Output: dumped_metadata, dump_cs

4. **Hook the logic at runtime** (catalog: frida-il2cpp-bridge)
   - frida-il2cpp-bridge gives full IL2CPP runtime access WITHOUT global-metadata.dat: enumerate assemblies/classes/methods, trace, and hijack any method by name
   - Hook the signing/API method (named via step 2) → confirm inputs → return value
   - Output: crypto_io[] samples, confirmed_method

5. **Read algorithm + reproduce** (skill: ghidra-reverse-engineering on the named fn → the brain)
   - Use the Il2CppDumper symbol script in Ghidra to read the signing function; reproduce offline; validate against step-4 samples
   - Output: algorithm, reproducer

6. **Synthesize + verify** (the brain)

## Common Blockers → Countermeasures
- global-metadata.dat encrypted / header tampered → Il2CppDumper fails; use Zygisk-Il2CppDumper (runtime memory dump) — step 3
- Unity version mismatch in Il2CppDumper → pin the dumper release to the unity_version; some versions need manual offsets
- Anti-cheat / integrity / frida detection → device-side Shamiko/stealth injection (see android RASP countermeasures); frida-il2cpp-bridge often still attaches post-checks
- Mono (not IL2CPP) build → wrong playbook; decompile Assembly-CSharp.dll directly (dnSpy/ILSpy)
- SSL pinning → RN/Unity typically still use platform/OkHttp or libcurl; standard frida-mitm-capture SSL bypass usually applies
