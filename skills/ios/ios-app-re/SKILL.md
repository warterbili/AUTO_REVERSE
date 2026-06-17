---
name: ios-app-re
description: iOS app reverse-engineering automation skill. Onboard the device (jailbreak/TrollStore/re-sign) → decrypt/dump the binary → class-dump/binary analysis → Frida dynamic (SSL unpin/jailbreak-detection bypass/keychain) → re-sign and deploy, using iOS tools from the catalog throughout (fetch on demand if missing). Trigger scenarios — reverse an iOS app, decrypt/dump the binary, decrypt IPA, class-dump, iOS Frida, jailbreak-detection bypass, iOS SSL pinning, Mach-O analysis, dyld_shared_cache.
---

# iOS App Reverse-Engineering Automation

iOS differs from Android: you must first solve "how to run instrumentation on the device." Pick tools from `catalog/ios.yaml`; for missing ones, `python tools/fetch.py <id>`. **A target iOS device (physical/jailbroken) is required.**

## Phase 0 — Onboard the device (pick one of three based on the target iOS version)
- **Jailbreak** (most capable): **palera1n** (`palera1n`) — checkm8, A11 and earlier only (iPhone 6s–X), iOS 15+. After jailbreaking, install `re.frida.server` via Sileo.
- **Non-jailbroken permanent install**: **TrollStore** (`trollstore`) — iOS ≤16.6.1 / 17.0, permanently installs a target app with Frida-gadget embedded.
- **Non-jailbroken re-signing**: **SideStore** (`sidestore`) — any modern iOS, auto-renews signatures, installs re-signed/patched IPAs.
Determine the device's iOS version + chip to decide which path to take; jailbroken devices use frida-server, non-jailbroken devices use frida-gadget.

## Phase 1 — Decrypt / dump
App Store apps' main binaries are encrypted; decrypt first: **bagbak** (`bagbak`) (the modern first choice, outputs a clean IPA).
```bash
bagbak <bundle-id-or-name>     # On a jailbroken device, dump the decrypted IPA + frameworks over USB
```
(The old tutorial favorite frida-ios-dump is stalled; use bagbak on iOS 15+.)

## Phase 2 — Static: class-dump + binary analysis
- **ipsw** (`ipsw`) Swiss-army knife: `ipsw class-dump`, Mach-O parsing, **extracting the dyld_shared_cache** (you must extract it first to reverse system frameworks like UIKit/Security).
- Decompilation: **Ghidra** (`ghidra-reverse-engineering`) / **IDA** (`ida-reverse-engineering`) / **Hopper** (`hopper`, the affordable commercial option on Mac).
- ObjC/Swift headers: **dsdump** (`dsdump`) (archived; for new targets use ipsw class-dump).
- Capability triage: the decrypted main binary is a Mach-O, so you can use **capa** (`capa-triage`) to tag capabilities.

## Phase 3 — Dynamic: Frida + objection
- **objection** (`objection-ios`) one-command: `ios sslpinning disable`, `ios jailbreak disable`, TouchID/FaceID bypass, `ios keychain dump`, heap enumeration.
- Quick recon: **Grapefruit** (`grapefruit`) Web UI (hooks/crypto/files/memory).
- Precise hooks: write Frida scripts directly (ObjC runtime: `ObjC.classes`, `Interceptor`); for a ready-made collection, see **frida-ios-hook** (`frida-ios-hook`).
- SSL unpinning (when objection isn't enough): codeshare `@federicodotta/ios13-pinning-bypass`.
- Jailbreak-detection bypass: objection `ios jailbreak disable`, or hook `fileExistsAtPath`/`fopen`/`canOpenURL`/`fork`.

## Phase 4 — Re-sign / patch / deploy
- After editing the Mach-O, re-sign + add entitlements: **ldid** (`ldid`) (`ldid -S` to add the `get-task-allow` debugging entitlement).
- Write hook patches (Logos) + package: **theos** (`theos`).
- Install back onto the device: directly on a jailbroken device; via **TrollStore/SideStore** on a non-jailbroken one.

## Minimal essential chain for iOS from scratch (in one line)
`palera1n|TrollStore|SideStore` (onboarding) + `bagbak` (decrypt/dump) + `ipsw` (class-dump/binary) + `Frida+objection` (dynamic/unpin/jailbreak bypass) + `ldid+theos` (re-sign and deploy). Of these, **ipsw / bagbak / objection / Frida / TrollStore** are absolutely core.

## Notes
- Framework-specific: if the target is Flutter/Unity/RN, switch to `catalog/frameworks.yaml` (reFlutter/frida-il2cpp-bridge/hermes-dec are mostly Android+iOS dual-platform).
- Commercial options (Hopper/IDA) are optional; closed-source tools like checkra1n/Sideloadly are mentioned only when there is no open-source alternative—do not use pirated software.
- There is currently no dedicated iOS-only Frida MCP; the general `frida-mcp` can cover iOS (see `catalog/mcp.yaml`).
