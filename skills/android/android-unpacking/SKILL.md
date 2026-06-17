---
name: android-unpacking
description: Android unpacking/unshelling—use frida-dexdump to dump the DEX released by a hardening packer from memory. Applicable when opening the APK in jadx only shows the packer stub and not the real business code (whole-release packers like Tencent Legu/Bangcle/360 hardening). Trigger scenarios — unpacking, unshelling, frida-dexdump, dump dex, hardening, can't see the real code, packer/shell, unpack.
---

# Android Unpacking (frida-dexdump)

`frida-dexdump` is installed globally (`frida-dexdump` is on PATH and relies on frida 17.7.3). At app runtime it scans process memory and dumps the DEX that has been decrypted and landed in memory; it is effective against **whole-release hardening packers**.

## When it's needed
After opening an APK with [[jadx-reverse-engineering]] / [[android-re-decompile]], if:
- You only see a few `StubApp` / proxy `Application` classes and no real business logic
- `classes.dex` is very small or has very few classes
→ it means the app is hardened; you need to unpack first, then feed the dumped DEX back into jadx to inspect.

## Prerequisites
- A device is connected and `frida-server` is running on it
- The target app is installed

## Usage
```bash
# When the target app is already in the foreground (most stable): open the app manually first and let it finish hardening/decryption
frida-dexdump -FU                 # -F=attach foreground app, -U=USB device
# Or specify a package name to spawn
frida-dexdump -U -f <package_name>
# Specify output directory + deep search (when the packer hides things deeply)
frida-dexdump -FU -d -o ./dexout
```
The dumped `*.dex` files are in the output directory; drag them straight into jadx-gui or run `jadx ./dexout/*.dex` to continue the analysis.

## Limitations (important)
- Only effective against "whole-release" packers; it is powerless against **method-extraction/VMP packers** (the dumped method bodies come out empty)—those require FART/active-invocation-style tooling or manual work, and modern packers usually require device-side Shamiko/ZygiskFrida to first defeat Frida detection
- Dump timing must be after hardening decryption: let the app fully start and reach the main screen before dumping
- Multi-DEX apps dump multiple files; merge them into one directory for jadx

## Connecting with other skills
- Before unpacking: [[apktool-decompile]] to check whether the Application class in `AndroidManifest` is a packer stub
- After unpacking: dumped DEX → [[jadx-reverse-engineering]] / [[android-re-decompile]] to inspect the real code → [[frida-mitm-capture]] to capture traffic
- If the packer's Frida detection causes the dump to fail: a device-side anti-detection layer is needed (Shamiko + ZygiskFrida)
