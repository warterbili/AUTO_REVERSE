---
name: jni-env-patching
description: Methodology for stubbing out the JNI environment when emulating an Android SO with unidbg. When native code calls back into the Java layer via JNI to obtain data (device info, credentials, system properties, etc.) and raises an UnsupportedOperationException or a [JNI] unhandled error, follow the principle of "read the Java layer first, then supply a reasonable value" and implement these callbacks in an AbstractJni subclass. Trigger scenarios: unidbg reports an unhandled JNI method; stubbing DvmClass/DvmObject/AbstractJni callbacks; crashes related to FindClass/GetStaticField/CallObjectMethod; simulating system properties such as SDK_INT/Build/TelephonyManager.
---

# JNI Environment Stubbing Methodology

## Overview

When emulating an Android SO with unidbg, the native code calls back into the Java layer via JNI to obtain data (device info, credentials, system properties, etc.). You need to implement these callbacks one by one in an `AbstractJni` subclass so the SO receives reasonable values and continues executing.

**Core principle: read the Java layer first, then supply a reasonable value. Do not stub the environment blindly.**

> **Specialization convention**: any experience in this document that pertains to a specific .so file (concrete obfuscated method names, dispatcher structure, constant values, etc.) must note its source at the beginning of that section in the following format:
> ```
> > [Specialized] libXXX.so (from com.xxx.xxx APK, version x.x.x)
> ```
> General methodology does not need to be annotated; only add the specialization marker when a passage **applies only to a specific SO**.

---

## Standard Stubbing Methodology (by priority)

### Step 1: Identify the crash error

unidbg error forms:
- `UnsupportedOperationException: com/package/ClassName->methodName(args)ReturnType` — a JNI callback needs to be stubbed
- `[JNI] unhandled: signature` — an unhandled method flagged in the log
- `debugger break at 0x...` — an unsupported syscall or native crash

### Step 2: Inspect the semantics in the Java layer (JADX or apktool smali)

**Prefer JADX**:
```bash
jadx -d decompiled/ base.apk
# Find the corresponding class under decompiled/sources/
```

**When JADX cannot decompile, use apktool to get smali**:
```bash
apktool d base.apk -o apktool_out
# Find the .smali file of the corresponding class under apktool_out/smali*/
```

Key points for reading smali:
- `.method public static/virtual methodName(args)ReturnType` — method signature
- `packed-switch` / `sparse-switch` — switch branches
- `invoke-static/virtual/interface` — method call chain
- Obfuscated string constants: `const-string v0, "3632245A..."` + `invoke-static {v0, key}, ...uvwwvwwvu` → XOR deobfuscation

### Step 3: Supply a random yet reasonable value

Determine the return value range based on the method's semantics:
- `getPackageName()` → package name string
- `getAndroidId()` → 16-character random hex
- `isEmpty()` → determined by whether the receiver object is empty
- Enum conversion / flag fields → refer to the real APK's static final constants
- Device info → refer to a real device profile (brand/model/sdk, etc.)

### Step 4: When uncertain, Frida-hook a real device to obtain the actual value

```javascript
// Template: hook a Java callback method (example class name from libtargetsdk.so)
Java.perform(function() {
    var TargetClass = Java.use("com.example.targetsdk.TargetClass");
    TargetClass.targetMethod.implementation = function(arg1) {
        var result = this.targetMethod(arg1);
        console.log("[HOOK] targetMethod(" + arg1 + ") => " + result);
        return result;
    };
});
```

```bash
# spawn mode (avoids attach timeouts)
frida -f com.target.package -l hook_script.js
```

---

## Smali Reading Quick Reference

### Common obfuscation patterns

#### XOR string deobfuscation

> [Specialized] libtargetsdk.so (from a sample SDK APK)

```smali
const-string v0, "3632245A34353658263C342442271611131F1910"  # hex-encoded
const-string v1, "wwwuwwuwv"                                # XOR key
invoke-static {v0, v1}, L...;->uvwwvwwvu(...)Ljava/lang/String;
```
Decoding: convert hex to bytes, XOR each byte against the key (cycling) → plaintext string. Example:
- `"3632..."` ^ `"wwwuwwuwv"` → `"AES/CBC/PKCS7Padding"`

#### Enum-based dispatcher (JNI callback dispatch)

> [Specialized] libtargetsdk.so (from a sample SDK APK)

```smali
# vuwuuuvv(int cmd, Object arg) pattern
invoke-static {p0}, L...;->vvvvuuuvw(I)Lcom/.../Enum;  # int→enum
aget p0, v1, p0   # uwwvuuuwu[ordinal] → switch case
packed-switch p0, :pswitch_data_0
```
Understanding the mapping: locate the `uwwvuuuwu` array in `ClassName$1.smali` to obtain the complete enum ordinal → switch case mapping.

#### Static field constants (AES key params, etc.)
```smali
.field public static final CONST_NAME:I = 0x1ae  # = 430
```
In unidbg: `getStaticIntField` for the corresponding signature → return that integer value directly.

### Smali → JNI method correspondence

| Smali call | unidbg method |
|-----------|------------|
| `invoke-static` (static method) | `callStaticObjectMethodV` / `callStaticObjectMethod` |
| `invoke-virtual` (instance method) | `callObjectMethodV` / `callObjectMethod` |
| `invoke-virtual ... Z` (boolean) | `callBooleanMethodV` |
| `sget-object` (static field) | `getStaticObjectField` |
| `sget` (static int field) | `getStaticIntField` |
| `iget-object` (instance field) | `getObjectField` |

---

## Unidbg Stubbing Code Templates

### callObjectMethodV (instance method, returns object)
```java
@Override
public DvmObject<?> callObjectMethodV(BaseVM vm, DvmObject<?> dvmObject, DvmMethod dvmMethod, VaList vaList) {
    String sig = dvmMethod.getSignature();
    // Handle known signatures
    switch (sig) {
        case "android/content/Context->getPackageName()Ljava/lang/String;":
            return new StringObject(vm, "com.example.app");
        // ... more known methods
    }
    // Handle garbled (obfuscated) method names
    if (sig.chars().anyMatch(c -> c > 127)) {
        // Attempt to recover the real object via the JNI ref
        try {
            int ref = vaList.getFirstArgAsInt();
            DvmObject<?> refObj = vm.getObject(ref);
            if (refObj instanceof StringObject) {
                String val = (String) refObj.getValue();
                if (val != null && !val.isEmpty()) return refObj;
            }
        } catch (Exception ignored) {}
        // Return a reasonable default based on the receiver object's type
        if (dvmObject instanceof ArrayObject) { ... }
        return new StringObject(vm, "");
    }
    return super.callObjectMethodV(vm, dvmObject, dvmMethod, vaList);
}
```

### callBooleanMethodV (instance method, returns boolean)
```java
@Override
public boolean callBooleanMethodV(BaseVM vm, DvmObject<?> dvmObject, DvmMethod dvmMethod, VaList vaList) {
    String sig = dvmMethod.getSignature();
    if (sig.chars().anyMatch(c -> c > 127)) {
        // First check the Java layer: what is the semantics of this garbled boolean method?
        // Common semantics: isEmpty() → returns true when the receiver is empty
        // If the semantics is "isValid/hasData", it should return !isEmpty
        boolean isEmpty = (dvmObject instanceof StringObject)
            && (dvmObject.getValue() == null || ((String) dvmObject.getValue()).isEmpty());
        return isEmpty; // adjust according to the semantics
    }
    return super.callBooleanMethodV(vm, dvmObject, dvmMethod, vaList);
}
```

### callStaticObjectMethodV (static method, cmd dispatcher)
```java
@Override
public DvmObject<?> callStaticObjectMethodV(BaseVM vm, DvmClass dvmClass, DvmMethod dvmMethod, VaList vaList) {
    String sig = dvmMethod.getSignature();
    // Handle known static methods...

    // Distinguish between different garbled dispatchers
    if (sig.chars().anyMatch(c -> c > 127)) {
        char firstChar = sig.isEmpty() ? 0 : sig.charAt(0);
        // Distinguish different dispatchers by firstChar
        // e.g., firstChar=18 → vuwuuuvv(cmd, arg) dispatcher
        //       firstChar=115 → other garbled static methods
        int cmd = vaList.getFirstArgAsInt();
        if (firstChar == KNOWN_DISPATCHER_FIRST_CHAR) {
            return handleKnownDispatcher(cmd, vaList);
        }
        // For unknown garbled static methods: return null or a reasonable default
        return null;
    }
    return super.callStaticObjectMethodV(vm, dvmClass, dvmMethod, vaList);
}
```

### Dobby Hook (native function interception)
```java
Dobby dobby = Dobby.getInstance(emulator);
dobby.replace(soModule.base + 0xOFFSETL, new ReplaceCallback() {
    @Override
    public HookStatus onCall(Emulator<?> emulator, HookContext context, long originFunction) {
        // context.getLongArg(0), context.getLongArg(1) — read arguments
        // UnidbgPointer ptr = UnidbgPointer.pointer(emulator, context.getLongArg(0))
        // ptr.setInt(0, value) — write memory
        return HookStatus.LR(emulator, returnValue);  // return directly, do not execute the original function
    }
});
```

---

## Common JNI Stubbing Scenarios

### 1. sysinfo() syscall unsupported
Symptom: `debugger break at sysinfo`
Fix: Dobby-hook the sysinfo function in libc.so and populate a fake struct sysinfo

### 2. stoi() empty-string crash
Symptom: `[HOOK] stoi called with: 'Vo3'` or other garbage strings
Cause: a global variable it depends on (e.g. unk_61B2B8) was not initialized
Fix: find the initialization function (e.g. sub_2204B0) and call it directly after the SO is loaded; or supply the correct value via a JNI callback

### 3. AES-CBC decryption (javax.crypto.Cipher)

> [Specialized] libtargetsdk.so (from a sample SDK APK)

If the SO performs Java AES decryption via JNI and unidbg cannot execute it:
- Implement the same algorithm in Java (on the unidbg side):
```java
// AES/CBC/PKCS7Padding decryption (see vwwvuwwvw.uuwuuvuvw smali)
private String aesDecrypt(String base64Data, String base64Key) throws Exception {
    byte[] keyBytes = Base64.getDecoder().decode(base64Key);
    byte[] ivBytes = Arrays.copyOf(keyBytes, keyBytes.length / 2); // IV = first half
    byte[] data = Base64.getDecoder().decode(base64Data);
    SecretKeySpec keySpec = new SecretKeySpec(keyBytes, "AES");
    IvParameterSpec ivSpec = new IvParameterSpec(ivBytes);
    Cipher cipher = Cipher.getInstance("AES/CBC/PKCS7Padding");
    cipher.init(Cipher.DECRYPT_MODE, keySpec, ivSpec);
    return new String(cipher.doFinal(data), StandardCharsets.UTF_8);
}
```

### 4. SDK version stubbing (important limitation)

unidbg **supports at most Android SDK 23** (Android 6.0 Marshmallow).

When the target SO reads the SDK version via a JNI callback (e.g. `android/os/Build$VERSION->SDK_INT:I`):
- You **must** stay consistent with unidbg and return SDK 23
- You **must not** use the real device's actual SDK version (e.g. SDK 30/31/33, etc.), otherwise unidbg cannot support it

```java
@Override
public int getStaticIntField(BaseVM vm, DvmClass dvmClass, DvmField dvmField) {
    String sig = dvmField.getSignature();
    switch (sig) {
        case "android/os/Build$VERSION->SDK_INT:I":
            return 23;  // must match unidbg's highest supported version, do not use the real device version
    }
    return super.getStaticIntField(vm, dvmClass, dvmField);
}
```

### 5. Distinguishing the vuwuuuvv garbled dispatcher from other garbled static methods

> [Specialized] libtargetsdk.so (from a sample SDK APK)

- vuwuuuvv's garbled signature `firstChar` is a specific value (confirm it from the runtime log)
- Other garbled static methods have a different firstChar
- Distinguish them by the combination of `firstChar` + `sig length`; do not treat every garbled static as vuwuuuvv
- For unknown garbled static methods: return null first to observe the behavior, then refine step by step

---

## Debugging Tips

```java
// Print full information inside the JNI callback
System.out.println("[JNI] sig=" + sig + " firstChar=" + (int)sig.charAt(0)
    + " len=" + sig.length() + " dvmObj=" + (dvmObject != null ? dvmObject.getValue() : "null"));

// Print the first int argument of vaList
try { System.out.println("[JNI] arg0=" + vaList.getFirstArgAsInt()); } catch(Exception e) {}
```

Redirect the output to a file for easier analysis:
```bash
mvn test -pl unidbg-android -Dtest=MyEmulator 2>&1 | tee /tmp/unidbg_run.txt
grep -E "\[CMD\]|\[GARBLED|\[HOOK\]|Result" /tmp/unidbg_run.txt
```
