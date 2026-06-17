---
name: unidbg-emulation
description: Guide to emulating Android SO files with Unidbg. Use the JVM-based unidbg framework to locally emulate Android ARM32/ARM64 .so files for reverse engineering, algorithm extraction, signature generation, and reconstructing Java/Native call chains. Covers project structure (unidbg-android/unidbg-api/backend), writing Emulator/DalvikVM/AbstractJni test classes, rootfs configuration, choosing among the Unicorn2/Dynarmic/KVM/Hypervisor backends, and wiring up JNI callbacks (together with jni-env-patching). Trigger scenarios: setting up a unidbg project, running a .so's JNI methods, extracting cryptographic signatures, emulating SO algorithms.
---

# Guide to Emulating Android SO Files with Unidbg

## Overview

Unidbg is a Java-based emulation framework for Android ARM32/ARM64 native libraries. It can emulate the execution of Android SO files on the JVM, for scenarios such as reverse engineering, algorithm extraction, and signature generation.

## Project Structure

```
unidbg/
├── unidbg-api/              # Core API (Emulator, Memory, Backend interfaces)
├── unidbg-android/           # Android-specific layer (DalvikVM, JNI, Syscall)
│   └── src/test/java/        # ⬅ Put your test classes here
├── backend/
│   ├── unicorn2/             # Default backend (best compatibility)
│   ├── dynarmic/             # High-performance backend
│   ├── kvm/                  # Linux KVM backend
│   └── hypervisor/           # macOS Hypervisor backend
├── rootfs/                   # Emulated Android filesystem
└── mvnw / mvnw.cmd           # Maven Wrapper
```

### Key Directories
- **Test classes**: `unidbg-android/src/test/java/com/{package}/YourClass.java`
- **APK/SO files**: May be located inside or outside the project; reference them by absolute path
- **rootfs**: The `rootfs/` directory at the project root, containing emulated files such as `/system/lib64/` and `/proc/`

## Writing a Java Test Class

### Basic Template

```java
package com.example.app;

import com.github.unidbg.*;
import com.github.unidbg.arm.backend.Unicorn2Factory;
import com.github.unidbg.file.*;
import com.github.unidbg.linux.android.*;
import com.github.unidbg.linux.android.dvm.*;
import com.github.unidbg.linux.android.dvm.array.*;
import com.github.unidbg.linux.file.SimpleFileIO;
import com.github.unidbg.virtualmodule.android.*;

import java.io.File;
import java.io.IOException;

public class MyEmulation extends AbstractJni implements IOResolver<AndroidFileIO> {

    private final AndroidEmulator emulator;
    private final VM vm;
    private final Module module;

    // ========== IOResolver: intercept file access ==========
    @Override
    public FileResult<AndroidFileIO> resolve(Emulator<AndroidFileIO> emulator, String pathname, int oflags) {
        System.out.println("[IO] " + pathname);
        if (pathname.endsWith("base.apk")) {
            return FileResult.success(new SimpleFileIO(oflags, new File("/path/to/base.apk"), pathname));
        }
        return null; // null = fall back to default handling
    }

    public MyEmulation() throws IOException {
        // 1. Create the emulator
        AndroidEmulatorBuilder builder = new AndroidEmulatorBuilder(true) { // true = 64-bit
            @Override
            public AndroidEmulator build() {
                return new AndroidARM64Emulator(processName, rootDir, backendFactories) {};
            }
        };
        emulator = builder
                .setProcessName("com.example.app")
                .addBackendFactory(new Unicorn2Factory(true))
                .setRootDir(new File("rootfs"))
                .build();

        // 2. Memory and resolver
        Memory memory = emulator.getMemory();
        memory.setLibraryResolver(new AndroidResolver(23)); // API level

        // 3. System properties
        SystemPropertyHook spHook = new SystemPropertyHook(emulator);
        spHook.setPropertyProvider(key -> {
            switch (key) {
                case "ro.build.version.sdk": return "30";
                case "ro.product.model": return "Pixel 6";
                default: return null;
            }
        });
        memory.addHookListener(spHook);

        // 4. IO and threads
        emulator.getSyscallHandler().addIOResolver(this);
        emulator.getSyscallHandler().setEnableThreadDispatcher(true); // required for multithreaded SOs

        // 5. DalvikVM
        vm = emulator.createDalvikVM(new File("/path/to/base.apk"));
        vm.setJni(this);
        vm.setVerbose(true); // on during development, off in production

        // 6. Virtual modules (as needed)
        new JniGraphics(emulator, vm).register(memory); // libjnigraphics.so
        new AndroidModule(emulator, vm).register(memory); // libandroid.so

        // 7. Load the target SO
        DalvikModule dm = vm.loadLibrary(new File("/path/to/libtarget.so"), false);
        module = dm.getModule();

        // 8. JNI_OnLoad
        dm.callJNI_OnLoad(emulator);
    }

    // ========== JNI environment patching ==========

    @Override
    public DvmObject<?> callStaticObjectMethodV(BaseVM vm, DvmClass dvmClass, DvmMethod dvmMethod, VaList vaList) {
        String sig = dvmMethod.getSignature();
        switch (sig) {
            case "com/example/Bridge->getContext()Landroid/content/Context;":
                return vm.resolveClass("android/content/Context").newObject(null);
            // Add cases one by one according to the SO's actual calls...
        }
        return super.callStaticObjectMethodV(vm, dvmClass, dvmMethod, vaList);
    }

    @Override
    public DvmObject<?> callObjectMethodV(BaseVM vm, DvmObject<?> dvmObject, DvmMethod dvmMethod, VaList vaList) {
        String sig = dvmMethod.getSignature();
        switch (sig) {
            case "android/content/Context->getPackageName()Ljava/lang/String;":
                return new StringObject(vm, "com.example.app");
            case "android/content/Context->getPackageCodePath()Ljava/lang/String;":
                return new StringObject(vm, "/data/app/com.example.app/base.apk");
            case "android/content/Context->getFilesDir()Ljava/io/File;":
                return vm.resolveClass("java/io/File").newObject("/data/data/com.example.app/files");
            case "java/io/File->getAbsolutePath()Ljava/lang/String;":
                return new StringObject(vm, dvmObject.getValue().toString());
        }
        return super.callObjectMethodV(vm, dvmObject, dvmMethod, vaList);
    }

    @Override
    public DvmObject<?> getStaticObjectField(BaseVM vm, DvmClass dvmClass, String signature) {
        switch (signature) {
            case "android/os/Build->MODEL:Ljava/lang/String;": return new StringObject(vm, "Pixel 6");
            case "android/os/Build->BRAND:Ljava/lang/String;": return new StringObject(vm, "google");
            case "android/os/Build->FINGERPRINT:Ljava/lang/String;":
                return new StringObject(vm, "google/oriole/oriole:12/SP1A.210812.016/7679548:user/release-keys");
        }
        return super.getStaticObjectField(vm, dvmClass, signature);
    }

    @Override
    public int getStaticIntField(BaseVM vm, DvmClass dvmClass, String signature) {
        if ("android/os/Build$VERSION->SDK_INT:I".equals(signature)) return 31;
        return super.getStaticIntField(vm, dvmClass, signature);
    }

    // ========== Calling the target function ==========

    public void callTarget() {
        DvmClass clz = vm.resolveClass("com/example/Bridge");
        // Approach 1: call via the registered JNI method name
        DvmObject<?> result = clz.callStaticJniMethodObject(
            emulator, "nativeSign(I[Ljava/lang/Object;)[Ljava/lang/Object;",
            1, vm.addLocalObject(new ArrayObject(new DvmObject[]{new StringObject(vm, "data")}))
        );

        // Approach 2: call directly via offset address
        // Number ret = module.callFunction(emulator, 0x12345, arg0, arg1);
    }

    public static void main(String[] args) throws IOException {
        MyEmulation emu = new MyEmulation();
        emu.callTarget();
        emu.emulator.close();
    }
}
```

## Building and Running

### Method 1: Build with Maven Wrapper + run with java (recommended)

```bash
# Build (skip tests)
cd /path/to/unidbg
./mvnw package -DskipTests

# Run (requires the full classpath)
java -cp "unidbg-android/target/classes:\
unidbg-android/target/test-classes:\
unidbg-api/target/classes:\
backend/unicorn2/target/classes:\
$(find ~/.m2/repository -name '*.jar' | grep -E '(capstone|unicorn|keystone|jna|commons|log4j|asm)' | tr '\n' ':')" \
com.example.app.MyEmulation
```

### Method 2: Write a run script

```bash
#!/bin/bash
cd "$(dirname "$0")"

# Build
./mvnw package -DskipTests -q 2>&1 | tail -5
if [ $? -ne 0 ]; then echo "Build failed"; exit 1; fi

# Collect the classpath
CP="unidbg-android/target/classes"
CP="$CP:unidbg-android/target/test-classes"
CP="$CP:unidbg-api/target/classes"
CP="$CP:backend/unicorn2/target/classes"
for jar in $(find ~/.m2/repository -name '*.jar' 2>/dev/null | grep -v source | grep -v javadoc); do
    CP="$CP:$jar"
done

java -cp "$CP" com.example.app.MyEmulation
```

### Method 3: Run the test directly with Maven

```bash
./mvnw test -pl unidbg-android -Dtest=com.example.app.MyEmulation -DfailIfNoTests=false
```

## Common Issues and Solutions

### 1. `IllegalStateException: running` / ThreadDispatcher infinite loop

**Symptom**: The program hangs with no output, or loops endlessly on the `futex` syscall

**Cause**: The SO uses `pthread_create` internally to create threads, and unidbg's ThreadDispatcher may deadlock when emulating multithreading

**Solution**:
```java
// Option A: enable the thread dispatcher (works in most cases)
emulator.getSyscallHandler().setEnableThreadDispatcher(true);

// Option B: if it still hangs, hook pthread_create to skip thread creation entirely
Dobby dobby = Dobby.getInstance(emulator);
Symbol pthread_create = emulator.getMemory().findModule("libc.so").findSymbolByName("pthread_create");
dobby.replace(pthread_create, new ReplaceCallback() {
    @Override
    public HookStatus onCall(Emulator<?> emulator, HookContext ctx, long originFunction) {
        System.out.println("[HOOK] pthread_create skipped");
        return HookStatus.LR(emulator, 0); // return success without creating a thread
    }
});

// Option C: hook the specific function that hangs and force a return
long stuckFuncAddr = module.base + 0xXXXXX;
dobby.replace(stuckFuncAddr, new ReplaceCallback() {
    @Override
    public HookStatus onCall(Emulator<?> emulator, HookContext ctx, long originFunction) {
        return HookStatus.LR(emulator, 0);
    }
});
```

### 2. `UC_ERR_READ_UNMAPPED` / Invalid memory read

**Symptom**: `unicorn.UnicornException: Invalid memory read`

**Cause**: The SO accessed an unmapped memory address, usually because a JNI return value is incorrect or a global variable was not initialized

**Solution**:
- Review the JNI call log just before the exception and confirm the return values are sensible
- Check whether `callStaticObjectMethodV` / `callObjectMethodV` is missing a handler for some signature
- Use `vm.setVerbose(true)` to inspect the full JNI call chain

### 3. IOResolver file mapping

**Symptom**: `FileNotFoundException`, or a file read returns empty

**Key points**:
```java
@Override
public FileResult<AndroidFileIO> resolve(Emulator<AndroidFileIO> emulator, String pathname, int oflags) {
    // pathname is the path requested from inside the SO; map it to a real local file
    if (pathname.contains("base.apk")) {
        return FileResult.success(new SimpleFileIO(oflags, new File(LOCAL_APK_PATH), pathname));
    }
    // return null to fall back to default handling
    // return FileResult.failed(ENOENT) to emulate a nonexistent file
    return null;
}
```

**Paths commonly needing mapping**:
- `/data/app/{package}/base.apk` → local APK
- `/proc/self/maps` → can be faked with ByteArrayFileIO
- `/dev/__properties__` → handled by unidbg by default
- `/proc/stat` → handled by unidbg by default

### 4. Missing dependency SOs (libmediandk.so, libjnigraphics.so, etc.)

**Symptom**: `load dependency xxx.so failed`, missing symbol

**Solution**:
```java
// Substitute with virtual modules
new JniGraphics(emulator, vm).register(memory);  // libjnigraphics.so
new AndroidModule(emulator, vm).register(memory); // libandroid.so (AAssetManager, etc.)

// For libmediandk.so (AMediaDrm, etc.), it can usually be ignored
// If the SO actually calls these functions, hook them out
```

### 5. Reading assets inside the APK (PNG / config files, etc.)

**Symptom**: The SO reads assets from the APK via AAssetManager, then hangs or crashes

**Cause**: unidbg's AndroidModule virtual module has limited support for the AAsset API

**Solution**:
```java
// Option A: hook functions such as AAssetManager_open and return the file contents directly
// Option B: extract the APK's assets ahead of time and map them via IOResolver
// Option C: skip the asset-loading stage and call the target function directly
```

### 6. Signature verification / PackageManager

```java
// The APK signature must be returned correctly
case "android/content/pm/PackageManager->getPackageInfo(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;":
    return vm.resolveClass("android/content/pm/PackageInfo").newObject(certDerBytes);

case "android/content/pm/PackageInfo->signatures:[Landroid/content/pm/Signature;":
    DvmObject<?> sig = vm.resolveClass("android/content/pm/Signature").newObject(certDerBytes);
    return new ArrayObject(sig);

case "android/content/pm/Signature->toByteArray()[B":
    return new ByteArray(vm, certDerBytes);
```

How to obtain the real signature:
```bash
# Extract from the APK
keytool -printcert -jarfile base.apk
# Or with Python
unzip -p base.apk META-INF/CERT.RSA | openssl pkcs7 -inform DER -print_certs
```

## Debugging Techniques

### 1. traceCode - instruction-level tracing

```java
// Trace the entire module
emulator.traceCode(module.base, module.base + module.size);

// Trace a specific range
emulator.traceCode(module.base + 0x1000, module.base + 0x2000);
```

### 2. Hooking functions (Dobby)

```java
Dobby dobby = Dobby.getInstance(emulator);

// Replace a function (skip the original entirely)
dobby.replace(module.base + 0x12345, new ReplaceCallback() {
    @Override
    public HookStatus onCall(Emulator<?> emulator, HookContext ctx, long originFunction) {
        long arg0 = ctx.getLongArg(0);
        System.out.println("[HOOK] arg0 = 0x" + Long.toHexString(arg0));
        return HookStatus.LR(emulator, 0); // return 0
    }
});

// Wrap a function (insert logic before and after the original call)
dobby.wrap(module, "target_func", new WrapCallback<>() {
    @Override
    public void preCall(Emulator<?> emulator, HookContext ctx, HookEntryInfo info) {
        System.out.println("[PRE] entering target_func");
    }
    @Override
    public void postCall(Emulator<?> emulator, HookContext ctx, HookEntryInfo info) {
        System.out.println("[POST] target_func returned: " + ctx.getLongArg(0));
    }
});
```

### 3. Reading and writing memory

```java
// Read memory
byte[] data = emulator.getBackend().mem_read(address, size);

// Write memory
emulator.getBackend().mem_write(address, new byte[]{0, 0, 0, 0});

// Read a pointer (8 bytes, little-endian)
byte[] ptrBytes = emulator.getBackend().mem_read(addr, 8);
long ptr = 0;
for (int i = 7; i >= 0; i--) ptr = (ptr << 8) | (ptrBytes[i] & 0xFF);

// Read a C string
UnidbgPointer p = UnidbgPointer.pointer(emulator, address);
String str = p.getString(0);
```

### 4. Breakpoint debugging

```java
emulator.attach().addBreakPoint(module.base + 0x12345, (emu, addr) -> {
    // Print registers
    RegisterContext ctx = emu.getContext();
    System.out.println("X0 = 0x" + Long.toHexString(ctx.getLongArg(0)));
    System.out.println("X1 = 0x" + Long.toHexString(ctx.getLongArg(1)));
    return true; // true = continue execution
});
```

### 5. Syscall debugging

```java
// Enable verbose syscall logging
emulator.getSyscallHandler().setVerbose(true);

// Custom syscall handler (advanced)
// Subclass ARM64SyscallHandler and override the hook method
```

## Anti-Detection Essentials

Common detection checks performed by SOs, and how to counter them:

| Detection check | Countermeasure |
|--------|----------|
| `ro.kernel.qemu` | SystemPropertyProvider returns "0" |
| `/proc/self/maps` checked for unidbg | IOResolver returns faked content |
| Xposed detection | hook the detection function to return false |
| Root detection (su/magisk) | `File.exists()` returns false for su/magisk paths |
| Debugger detection (TracerPid) | `/proc/self/status` returns TracerPid: 0 |
| Signature verification | Provide the real APK signature DER bytes |
| frida detection | Report frida-related ports/files as nonexistent |

## Field Experience (MTGuard/Keeta case study)

### Execution flow
1. **JNI_OnLoad**: RegisterNatives registers the `main` method
2. **main(1, [appKey])**: initialization; obtains the following via the `NBridge.main2(cmd)` callback:
   - cmd=1: package name
   - cmd=2/3: Context
   - cmd=4: PIC filename (PNG)
   - cmd=5: SEC filename (XBT)
   - cmd=6: version number
3. **PIC loading**: read the PNG from the APK assets → decode pixels → extract the steganographic data
4. **main(2, [appKey, data, path])**: signature computation

### Known issues
- The `main(1)` init call triggers `UC_ERR_READ_UNMAPPED`, but it can be caught and execution can continue
- `triggerPicLoading` (sub_61140) hangs in a futex / thread-scheduling loop
- Root cause: PNG decoding relies on JniGraphics virtual implementations such as `AndroidBitmap_lockPixels`, which are incomplete

### Resolution approach
- Hook sub_61140 directly, or the PNG-decoding function inside it: decode the PNG in Java and write the pixel data into memory
- Or skip PIC loading and construct the decrypted PIC data structure directly
