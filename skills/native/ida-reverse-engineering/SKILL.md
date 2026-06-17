---
name: ida-reverse-engineering
description: Workflows and patterns for using IDA MCP and idat (headless) to analyze Android native libraries and JNI interfaces.
---

# IDA Reverse Engineering Skill

This skill documents effective patterns for analyzing Android native libraries (.so files) using IDA Pro — both via MCP server (GUI) and `idat` headless mode (CLI).

## Analysis Modes

### Mode 1: IDA MCP (GUI + RPC)
Use when IDA GUI is open with the MCP plugin active (Edit → Plugins → MCP, or `Ctrl+Option+M` on macOS).
- MCP RPC server listens on `http://127.0.0.1:13337`
- Tools: `decompile()`, `list_funcs()`, `lookup_funcs()`, `callgraph()`, `callees()`, `find()`, `py_eval()`

### Mode 2: idat Headless (No GUI Required) ⭐
Use `idat` for batch analysis without GUI, Accessibility permissions, or user interaction.
This is the **preferred mode** for automated/agent-driven analysis.

```bash
# Location (macOS, IDA Pro 9.3)
IDAT="/Applications/IDA Professional 9.3.app/Contents/MacOS/idat"

# Run analysis script (auto-analysis, then script, then exit)
"$IDAT" -A -S/path/to/script.py -L/path/to/output.log /path/to/binary.so

# If .i64 database already exists, it reuses it (no re-analysis needed)
```

**Key flags:**
- `-A`: Auto-analysis mode (no user prompts)
- `-S<script.py>`: Run IDAPython script after loading
- `-L<logfile>`: Redirect all output (including script prints) to log file
- First run creates `.i64` database; subsequent runs reuse it

**Script template:**
```python
import idaapi
import idautils
import idc

# Wait for auto-analysis to complete
idaapi.auto_wait()

# Optional: load Hex-Rays decompiler
if not idaapi.init_hexrays_plugin():
    print("[!] Hex-Rays not available")
    idc.qexit(1)

# --- Your analysis code here ---

# Decompile a function
cfunc = idaapi.decompile(0xADDRESS)
if cfunc:
    print(str(cfunc))

# Find xrefs to an address
for xref in idautils.XrefsTo(0xADDRESS):
    fname = idc.get_func_name(xref.frm)
    print(f"  xref from {hex(xref.frm)} in {fname}")

# Search strings
for s in idautils.Strings():
    if "keyword" in str(s):
        print(f"  String '{str(s)}' at {hex(s.ea)}")

# Always exit cleanly
idc.qexit(0)
```

## Core Workflows

### 1. Verification & Environment Identification
- **MCP**: `py_eval(code="import idaapi; print(idaapi.get_input_file_path())")`
- **idat**: Include in script: `print(idaapi.get_input_file_path())`

### 2. Locating JNI Entry Points
- **Static Linkage**: Search for functions starting with `Java_`
- **Dynamic Linkage (RegisterNatives)**: Search for JNI method signatures in strings, then follow xrefs to find the registration table

```python
# Find RegisterNatives registration tables
for s in idautils.Strings():
    sv = str(s)
    if sv in ["(I[Ljava/lang/Object;)[Ljava/lang/Object;", "(I[Ljava/lang/Object;)Ljava/lang/Object;"]:
        print(f"JNI sig '{sv}' at {hex(s.ea)}")
        for xref in idautils.XrefsTo(s.ea):
            # The xref location often contains: {method_name_ptr, signature_ptr, native_func_ptr}
            print(f"  ref from {hex(xref.frm)}")
            # Read the native function pointer nearby
```

### 3. Native Logic Analysis
- **Decompilation**: `idaapi.decompile(addr)` → returns pseudocode
- **Cross-references**: `idautils.XrefsTo(addr)` / `idautils.XrefsFrom(addr)`
- **Function callees**: iterate `idautils.FuncItems()` + `XrefsFrom` with `fl_CN`/`fl_CF` types
- **Global variable tracking**: Find all references to a global address

```python
# Find all functions referencing a global variable
for xref in idautils.XrefsTo(0x1C10A0):
    fname = idc.get_func_name(xref.frm)
    print(f"  ref from {hex(xref.frm)} in {fname}")
```

### 4. Advanced Searching
- **String search**: Iterate `idautils.Strings()` with keyword filter
- **Immediate values**: Use `idautils.CodeRefsTo()` or manual disasm scanning
- **Function enumeration**: `idautils.Functions()` to iterate all functions

### 5. Anti-Obfuscation Analysis
Many protected native libraries use:
- **Control Flow Flattening (CFF)**: Look for dispatcher functions with `BR X8` indirect jumps
- **String encryption**: Look for `xor_decrypt_string()` patterns
- **Atomic state machines**: `LDAXR/STLXR` patterns on global state variables

```python
# Detect CFF dispatcher patterns - functions with indirect branches
for ea in idautils.Functions():
    func = idaapi.get_func(ea)
    if not func:
        continue
    for item in idautils.FuncItems(ea):
        mnem = idc.print_insn_mnem(item)
        if mnem == "BR":
            print(f"  Indirect branch in {idc.get_func_name(ea)} at {hex(item)}")
```

### 6. pthread Analysis
For multi-threaded native code (common in security SDKs):

```python
# Find all pthread_create call sites
for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    if name == "pthread_create":
        for xref in idautils.XrefsTo(ea):
            caller = idc.get_func_name(xref.frm)
            print(f"  pthread_create called from {hex(xref.frm)} in {caller}")
```

## Example: Full Binary Survey Script

```python
import idaapi, idautils, idc

idaapi.auto_wait()
idaapi.init_hexrays_plugin()

# 1. JNI exports
print("=== JNI Exports ===")
for ea in idautils.Functions():
    name = idc.get_func_name(ea)
    if "JNI_OnLoad" in name or name.startswith("Java_"):
        print(f"  {name} at {hex(ea)}")

# 2. Interesting strings
print("\n=== Key Strings ===")
keywords = ["basic_string", "pthread", "encrypt", "sign", "token", "null"]
for s in idautils.Strings():
    sv = str(s)
    if any(k in sv.lower() for k in keywords):
        print(f"  '{sv}' at {hex(s.ea)}")

# 3. pthread usage
print("\n=== pthread_create Sites ===")
for ea in idautils.Functions():
    if idc.get_func_name(ea) == "pthread_create":
        for xref in idautils.XrefsTo(ea):
            print(f"  from {hex(xref.frm)} in {idc.get_func_name(xref.frm) or '?'}")

# 4. Decompile specific targets
targets = [0x12345]  # Add your addresses
for addr in targets:
    print(f"\n=== Decompile {hex(addr)} ===")
    try:
        cfunc = idaapi.decompile(addr)
        if cfunc:
            print(str(cfunc))
    except:
        print("[!] Failed")

idc.qexit(0)
```

## Best Practices

- **Prefer idat for agent workflows**: No GUI needed, no Accessibility permissions, scriptable
- **Reuse .i64 database**: First `idat` run creates it; subsequent runs load instantly
- **Combine with JADX**: Use JADX for Java/smali, IDA for native .so
- **Combine with unidbg**: Use IDA to find addresses/offsets, unidbg to emulate
- **Split large analysis into multiple scripts**: Each `idat` run takes ~30-60s to load; batch related queries together
- **Limit decompiler output**: Some obfuscated functions produce huge pseudocode; truncate in script
- **Offset accuracy**: IDA uses file-relative addresses; unidbg adds a base address (e.g., 0x12000000)
- **Incremental analysis**: Start from JNI entry → follow call chain → decompile key functions
