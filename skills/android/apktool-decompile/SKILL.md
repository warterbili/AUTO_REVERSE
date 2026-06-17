---
name: apktool-decompile
description: A complete guide and workflow for decompiling, modifying, and repackaging Android APKs with apktool.
---

# Apktool Decompilation Skill

Apktool is a powerful tool for reverse-engineering Android APK files. It can decode an APK into a near-original form (including resource files and smali code) and lets you repackage it after modification.

**Version**: 2.12.1 (with smali 3.0.9 and baksmali 3.0.9)

## Core Commands

### 1. Decode an APK (decode)

Decompile an APK file into readable resources and smali code.

```bash
apktool d <apk-file> [options]
```

**Common options**:
| Option | Description |
|------|------|
| `-o, --output <dir>` | Specify the output directory (default: apk.out) |
| `-f, --force` | Force-delete an existing target directory |
| `-r, --no-res` | Do not decode resource files (speeds up processing) |
| `-s, --no-src` | Do not decode source code (smali) |
| `-p, --frame-path <dir>` | Use framework files from the specified directory |
| `-t, --frame-tag <tag>` | Use framework files with the specified tag |

**Examples**:
```bash
# Basic decode
apktool d app.apk

# Specify the output directory
apktool d app.apk -o app_decoded

# Force-overwrite an existing directory
apktool d app.apk -f -o app_decoded

# Decode resources only, not smali (quick look at resources)
apktool d app.apk -s -o app_res_only

# Decode smali only, not resources
apktool d app.apk -r -o app_smali_only
```

### 2. Rebuild an APK (build)

Rebuild an APK from a decoded directory.

```bash
apktool b <apk-dir> [options]
```

**Common options**:
| Option | Description |
|------|------|
| `-o, --output <file>` | Specify the output file (default: dist/name.apk) |
| `-f, --force` | Skip change detection and rebuild all files |
| `-p, --frame-path <dir>` | Use framework files from the specified directory |

**Examples**:
```bash
# Basic build
apktool b app_decoded

# Specify the output file
apktool b app_decoded -o app_modified.apk

# Force a rebuild
apktool b app_decoded -f -o app_modified.apk
```

### 3. Install a Framework File (install-framework)

Install a system framework APK so that apps depending on system resources decode correctly.

```bash
apktool if <framework.apk> [options]
```

**Examples**:
```bash
# Install the system framework
apktool if framework-res.apk

# Install to a specific directory with a tag
apktool if framework-res.apk -p ~/frameworks -t samsung
```

## Decoded Directory Structure

```
app_decoded/
├── AndroidManifest.xml      # App manifest (decoded to readable XML)
├── apktool.yml              # apktool config file
├── assets/                  # Original asset files
├── lib/                     # Native libraries (.so files)
│   ├── arm64-v8a/
│   ├── armeabi-v7a/
│   └── x86_64/
├── original/                # Original META-INF and signature info
├── res/                     # Resource files (decoded)
│   ├── drawable/
│   ├── layout/
│   ├── values/
│   └── ...
├── smali/                   # smali code of the main dex
├── smali_classes2/          # smali code of classes2.dex
├── smali_classes3/          # smali code of classes3.dex
└── unknown/                 # Unrecognized files
```

## Practical Workflows

### Workflow 1: Quickly Inspect APK Contents

```bash
# 1. Decode the APK
apktool d target.apk -o target_decoded

# 2. View AndroidManifest.xml
cat target_decoded/AndroidManifest.xml

# 3. View resource strings
cat target_decoded/res/values/strings.xml
```

### Workflow 2: Modify and Repackage

```bash
# 1. Decode
apktool d target.apk -f -o target_decoded

# 2. Modify files (e.g., smali code or resources)
# ... edit target_decoded/smali/... or target_decoded/res/...

# 3. Rebuild
apktool b target_decoded -o target_modified.apk

# 4. Sign (using jarsigner or apksigner)
# Note: a repackaged APK must be re-signed before it can be installed
jarsigner -verbose -keystore my.keystore target_modified.apk alias_name
# or
apksigner sign --ks my.keystore target_modified.apk
```

### Workflow 3: Extract and Analyze Native Libraries

```bash
# 1. Decode only the resource structure (skip smali for speed)
apktool d target.apk -s -o target_libs

# 2. Extract the native library for analysis
cp target_libs/lib/arm64-v8a/libtarget.so ./

# 3. Analyze with IDA or Ghidra
```

### Workflow 4: Analyze Smali Code

```bash
# 1. Decode
apktool d target.apk -o target_decoded

# 2. Search for specific strings or methods
grep -r "signature" target_decoded/smali/
grep -r "encrypt" target_decoded/smali/

# 3. Find a specific class
find target_decoded/smali* -name "SignatureHelper.smali"
```

## Smali Basics

Smali is a readable representation of Android Dalvik bytecode.

### Class Definition
```smali
.class public Lcom/example/MyClass;
.super Ljava/lang/Object;
.source "MyClass.java"
```

### Method Definition
```smali
.method public static myMethod(Ljava/lang/String;I)Ljava/lang/String;
    .registers 4
    # code...
    return-object v0
.end method
```

### Common Type Signatures
| Signature | Java type |
|------|-----------|
| `V` | void |
| `Z` | boolean |
| `B` | byte |
| `I` | int |
| `J` | long |
| `F` | float |
| `D` | double |
| `[I` | int[] |
| `Ljava/lang/String;` | String |

### Common Smali Modifications

**Bypass a method check (return true)**:
```smali
# Original code
.method public isValid()Z
    # ... complex check logic
.end method

# Modified to always return true
.method public isValid()Z
    .registers 1
    const/4 v0, 0x1
    return v0
.end method
```

**Add a logging call**:
```smali
const-string v0, "TAG"
const-string v1, "Debug message"
invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I
```

## Best Practices

### 1. Handling Large APKs
- Use the `-r` or `-s` option to decode only the parts you need
- A multi-dex APK produces `smali_classes2/`, `smali_classes3/`, etc.

### 2. Handling System Apps
- First install the framework-res.apk that matches the device
- Use the `-t` tag to distinguish frameworks from different devices

### 3. Repackaging Notes
- A repackaged APK must be re-signed
- Some apps verify their signature and require extra handling
- Keep the `apktool.yml` file to ensure a correct rebuild

### 4. Pairing with Other Tools
- **JADX**: view more readable Java source
- **IDA/Ghidra**: analyze native libraries
- **Frida**: dynamic hooking and debugging

## Common Issues

### Decode Failure
```bash
# Try installing the corresponding framework file
apktool if /path/to/framework-res.apk

# Or skip resource decoding
apktool d app.apk -r
```

### Rebuild Failure
```bash
# Check for smali syntax errors
# Force a rebuild
apktool b app_decoded -f
```

### Signature Issues
```bash
# Generate a test keystore
keytool -genkey -v -keystore test.keystore -alias test -keyalg RSA -keysize 2048 -validity 10000

# Sign the APK
apksigner sign --ks test.keystore --ks-key-alias test app_modified.apk

# Or use jarsigner
jarsigner -keystore test.keystore app_modified.apk test
```

## Helper Scripts

This skill provides the following helper scripts:

### analyze_apk.sh
Quickly analyzes an APK file, showing basic info, permissions, smali statistics, and the native library list.
```bash
./resources/analyze_apk.sh target.apk
```

### rebuild_and_sign.sh
Rebuilds and signs a modified APK in one step.
```bash
./resources/rebuild_and_sign.sh app_decoded output.apk
```

### search_smali.sh
Searches smali code for a specific pattern, with filtering by method, class, string, or native method.
```bash
./resources/search_smali.sh app_decoded "signature"
./resources/search_smali.sh app_decoded "encrypt" -m  # search methods only
./resources/search_smali.sh app_decoded "api_key" -s  # search strings only
```

## References

- Official docs: https://apktool.org
- Smali/Baksmali: https://github.com/google/smali
- Android signing tools: https://developer.android.com/studio/command-line/apksigner
