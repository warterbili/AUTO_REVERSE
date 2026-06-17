---
name: objection-runtime
description: Use objection (a Frida-based runtime mobile exploration tool) for one-command runtime analysis of Android apps—SSL pinning bypass, root/debugger detection bypass, in-memory class and method enumeration, heap object search and invocation, keystore/filesystem browsing, and runtime hooking, all without hand-writing a Frida script for each target. Trigger scenarios — runtime exploration, objection, SSL unpinning, list loaded classes, dump in-memory objects, bypass root detection, explore an app's runtime state.
---

# objection Runtime Exploration

`objection` is a Frida-based runtime mobile toolkit, installed globally (`objection` is on PATH and relies on your existing frida 17.7.3). It wraps common Frida operations into interactive commands, ideal for **quickly getting a read on the runtime state of a running app**. It serves as a complementary layer between `frida-hooking` (hand-written scripts) and `frida-mitm-capture` (traffic capture).

## Prerequisites
- A device is connected (`adb devices` shows a device) and `frida-server` is running on it
- The target app is installed

## Launching
```bash
# Attach to an already-running app (recommended, more stable)
objection -g <package_name> explore
# Or spawn the app
objection -g <package_name> explore --startup-command "android hooking watch class_method ..."
```

## High-frequency commands (after entering the explore session)
```
android sslpinning disable                 # One-command SSL pinning bypass (covers multiple implementations)
android root disable                        # Bypass common root detection
android hooking list classes                # List all loaded classes
android hooking search classes <keyword>     # Search classes by keyword
android hooking list class_methods <class>   # List the methods of a class
android hooking watch class <class> --dump-args --dump-return --dump-backtrace
android heap search instances <class>        # Find live instances of the class on the heap
android heap execute <obj_id> <method>       # Directly invoke a method on a live object
android keystore list                        # List keystore entries
memory list modules / memory list exports <module>
env                                          # Print the app's directory structure
```

## Batch / scripted (suitable for agent-driven use)
```bash
# Write commands into a file, execute them all at once, then exit
objection -g <package_name> explore -c commands.txt
# Or inject a single command with --startup-command
```

## Connecting with other skills
- First use objection `sslpinning disable` + `root disable` to open things up, then use [[frida-mitm-capture]] to capture plaintext traffic
- Once objection has located the key class/method, switch to [[frida-hooking]] to write a precise hook for the arguments/return value
- After discovering a native call boundary, switch to [[ida-reverse-engineering]] / [[ghidra-reverse-engineering]] to inspect the .so

## Common pitfalls
- objection depends on the frida-tools version matching the device's frida-server; this machine's frida is 17.7.3, so make sure the device's frida-server is the same major version
- Modern packers/protectors may detect Frida/objection—device-side hiding via Shamiko/ZygiskFrida is needed (see toolchain Phase 7)
