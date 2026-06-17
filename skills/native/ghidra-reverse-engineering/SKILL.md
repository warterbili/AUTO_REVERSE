---
name: ghidra-reverse-engineering
description: Use Ghidra (the free NSA reverse-engineering framework) + GhidraMCP to analyze Android native libraries (.so) and JNI interfaces—via MCP, let Claude drive Ghidra directly to do decompilation, cross-references, function renaming, string/constant search, and P-code dataflow analysis; plus batch analysis with the analyzeHeadless headless scripting interface. This is the local free IDA replacement (use it when no IDA Pro license is available). Trigger scenarios — analyze .so, Ghidra, decompile native, locate JNI entry, view call graph, native algorithm, ghidra headless, drive Ghidra via MCP.
---

# Ghidra + GhidraMCP Native Reverse Engineering

The Ghidra install directory is referenced by the environment variable `${GHIDRA_HOME}` (e.g. `.../ghidra_<ver>_PUBLIC`, detected by setup/doctor or set manually). GhidraMCP (the bethington fork; the extension version number must match the local Ghidra, providing ~249 MCP tools) plugs into Claude Code as an MCP server. **This is the free native-analysis workhorse when IDA Pro is unavailable.** The methodology is the same as [[ida-reverse-engineering]]; only the backend changes to Ghidra.

## Two ways to use it

### A. GhidraMCP (interactive, agent-driven, recommended)
One-time manual prerequisite steps (GUI; only you can click these):
1. Launch Ghidra: `& "${GHIDRA_HOME}\ghidraRun.bat"`
2. `File → Install Extensions → +`, check GhidraMCP → restart Ghidra
3. Create/open a project, import the target `.so`, and let auto-analysis finish
4. In the CodeBrowser, enable **GhidraMCPPlugin** via `File → Configure → Miscellaneous` (it starts an HTTP server, default port 8089)

After that, the `ghidra` server in `.mcp.json` (`bridge_mcp_ghidra.py`) can connect, and Claude can call the MCP tools directly: decompile functions, list imports/exports, xref, batch rename, P-code dataflow, string search, and so on.

### B. analyzeHeadless (headless scripting, batch/CI)
Analyze in one shot via script without opening the GUI:
```bash
GH="${GHIDRA_HOME}"
"$GH\support\analyzeHeadless.bat" <project_dir> <project_name> -import <target.so> -postScript <your_script.py>
```
Ghidra ships with a Python (Jython)/PyGhidra scripting interface (`getFunctionAt`, `getReferencesTo`, the decompiler API), which can enumerate JNI exports, batch-decompile, and export pseudo-C.

## Standard flow for Android native analysis
1. **Locate the JNI entry**: search for `Java_*` export functions + find `RegisterNatives` inside `JNI_OnLoad` (dynamically registered methods are mapped Java↔native here)
2. **Decompile the core function**: Ghidra's decompiler produces pseudo-C; inspect the signature-generation/crypto logic
3. **xref to trace the call graph**: who calls this function, which globals it references
4. **Deobfuscation recognition**: control-flow flattening (CFF dispatcher), string encryption, atomic state machines—when OLLVM flattening is hit, switch to `deflat` (local `deflat.bat`; angr already installed)
5. **Get the offset** → hand it to [[unidbg-emulation]] to run offline, or [[frida-hooking]] to hook and verify on a real device

## Connecting with other skills
- First use [[capa-triage]] for capability triage on the .so (crypto/anti-debug/network + hit addresses), then enter Ghidra with the addresses for a close read
- Source of the .so: [[apktool-decompile]] to unpack and grab `lib/arm64-v8a/*.so`
- After understanding the algorithm in Ghidra: [[unidbg-emulation]] + [[jni-env-patching]] to reproduce the signature

## Notes
- The extension version has been patched to 12.0.3; if you upgrade Ghidra you must re-adapt the extension version number
- GhidraMCP's interactive mode requires a running Ghidra GUI instance with the target program loaded, otherwise the bridge has no data to read
