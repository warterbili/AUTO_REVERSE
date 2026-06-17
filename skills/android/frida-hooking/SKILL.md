---
name: frida-hooking
description: Comprehensive guide and patterns for writing Frida hook scripts for Android (Java & Native).
---

# Frida Hooking Skill

This skill provides a structured approach and reusable patterns for dynamic instrumentation using Frida, based on official documentation and real-world reverse engineering workflows.

## Core Concepts

### 1. Attachment & Environment
- **Java.perform(fn)**: Essential wrapper for any Java-related work. It ensures the thread is attached to the VM.
- **Java.use(className)**: Synchronously gets a JavaScript wrapper for a class. Use this for hooking.
- **Java.choose(className, callbacks)**: Scans the heap for alive instances of a class.

### 2. Java Hooking Patterns

#### Method Implementation
```javascript
var TargetClass = Java.use("com.package.TargetClass");
TargetClass.methodName.implementation = function(arg1, arg2) {
    console.log("Entering methodName");
    var result = this.methodName(arg1, arg2); // Call original
    console.log("Exit methodName, result: " + result);
    return result;
};
```

#### Overload Handling
```javascript
TargetClass.methodName.overload('java.lang.String', 'int').implementation = function(s, i) {
    return this.methodName(s, i);
};
```

#### Constructor Hooking
```javascript
TargetClass.$init.implementation = function(args) {
    return this.$init(args);
};
```

#### Field Access
```javascript
// Accessing a field value
var val = this.field_name.value;
// Modifying a field value
this.field_name.value = newValue;
```

### 3. Native (Interceptor) Patterns

#### Attaching to Exports
```javascript
Interceptor.attach(Process.findModuleByName("libname.so").findExportByName("symbol_name").base, {
    onEnter: function(args) {
        console.log("Args[0]: " + args[0]);
    },
    onLeave: function(retval) {
        console.log("Return Value: " + retval);
    }
});
```

#### Memory Operations
- **Reading**: `ptr.readUtf8String()`, `ptr.readByteArray(len)`.
- **Writing**: `ptr.writeUtf8String(str)`, `ptr.writeByteArray(arr)`.
- **Hexdump**: `console.log(hexdump(ptr, { offset: 0, length: 64, header: true, ansi: true }))`.

### 4. Advanced Scenarios

#### Syscall Tracing (frida-strace, Frida 17.8+)

`frida-strace` is the syscall-tracing tool officially introduced in Frida 17.8. Built on Android's eBPF backend and iOS's CoreProfile ktrace, it is a powerful tool for analyzing RASP detection and anti-debugging.

```bash
# spawn the target app and trace all syscalls
frida-strace -U -f com.target.app

# attach to a running process
frida-strace -U -p <pid>

# spawn multiple processes at once
frida-strace -U -f com.target.app -f com.target.service

# trace all processes for a given user (Android-only)
frida-strace -U -u com.target.app
```

**Typical use cases:**
- **RASP detection analysis**: find syscalls that read process information, such as `openat("/proc/self/maps")` and `openat("/proc/<pid>/status")`
- **Anti-debugging detection**: find `ptrace(PTRACE_TRACEME)`, `getppid()`, and the like
- **File-access monitoring**: path arguments are decoded automatically, so you can see exactly which files the app accesses
- The output includes a callstack plus symbolication, letting you jump straight to the calling code

**Recommended workflow:**
1. First scan all syscalls with `frida-strace` to quickly locate suspicious detection points
2. Then Interceptor-hook the corresponding userland function to confirm the detection logic
3. Modify the return value to bypass the detection

#### Hooking JNI RegisterNatives
Essential for discovering dynamically registered native functions in obfuscated binaries.
(See template in `resources/register_natives_hook.js`)

#### Stalker (Code Tracing)
Use Stalker for deep instruction-level tracing or finding execution paths in heavily obfuscated code.

### 5. Spawn Mode and the `--no-pause` Argument

When using `-f` spawn mode, different Frida versions behave differently with respect to pausing the process:

| Frida version | Default behavior | Pause control |
|---|---|---|
| ≤ 15.x | Pauses after spawn; requires a manual `%resume` | `--no-pause` resumes automatically |
| 16.x ~ 17.x | **Resumes automatically** after spawn | `--no-pause` **has been removed; using it raises an unrecognized arguments error** |
| 17.x+ | **Resumes automatically** after spawn | Use `--pause` to pause (no pause by default) |

**Important**: Never use `--no-pause`; Frida 17+ exits with an error immediately.

```bash
# ❌ Wrong — Frida 16+/17+ errors with: unrecognized arguments: --no-pause
frida -U -f com.target.app --no-pause -l hook.js

# ✅ Correct — Frida 16+/17+ resumes automatically by default
frida -U -f com.target.app -l hook.js

# ✅ To pause (Frida 17+)
frida -U -f com.target.app --pause -l hook.js
```

**If you need to pause the spawned process on 16.x+**, use the Python API:
```python
device = frida.get_usb_device()
pid = device.spawn(["com.target.app"])
session = device.attach(pid)
script = session.create_script(open("hook.js").read())
script.load()
# Control when to resume manually
device.resume(pid)
```

## Best Practices

### 1. Robust Hooking
- **Try-Catch Wrapper**: Always wrap implementations in try-catch to avoid crashing the target application on script errors.
- **Logging**: Use `console.log` for debugging, but be mindful of performance in high-frequency functions.

### 2. Multi-Architecture Support
- Use `Process.pointerSize` or `Process.arch` to handle offsets or data types that vary between arm/arm64.

### 3. Data Integrity
- When modifying buffers in `onEnter`, be careful not to trigger memory corruption if the new data is larger than the original allocation.

## Resources
- [register_natives_hook.js](resources/register_natives_hook.js)
- [generic_interceptor.js](resources/generic_interceptor.js)
- [java_method_tracer.js](resources/java_method_tracer.js)
