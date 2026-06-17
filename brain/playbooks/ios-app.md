# Playbook: ios-app
# Applies to: iOS apps. Corresponding skill: ios-app-re. Requires a target iOS device.

## Goal
Figure out an iOS app's endpoints/signing/logic, with the ability to instrument it dynamically and reproduce the behavior.

## Steps (the brain proceeds in order; each step emits a findings.json)

0. **Device access** (pick one based on iOS version/chip): palera1n jailbreak (A11 and earlier, iOS 15+) | TrollStore (≤16.6.1/17.0) | SideStore (any version, auto-renewing re-sign)
   - Jailbroken → frida-server; non-jailbroken → inject frida-gadget into a re-signed IPA
1. **Decrypt**: bagbak → decrypted IPA + frameworks (iOS 15+; avoids the stalled frida-ios-dump)
2. **Static**: ipsw class-dump + Mach-O parsing + extract the dyld_shared_cache (must extract before reversing system frameworks) → Ghidra/IDA/Hopper; capa triage on the main binary
3. **Dynamic**: objection (ios sslpinning disable / jailbreak disable / keychain dump) + Grapefruit recon + targeted Frida scripts
4. **Capture traffic**: after SSL unpinning, proxy plaintext API traffic (objection or the codeshare ios13-pinning-bypass)
5. **Re-sign / patch**: ldid to re-sign + add entitlements; theos to write Logos hooks and package → deploy via TrollStore/SideStore
6. **Synthesize**: produce the report + reproduction

## Minimal Core Chain
palera1n|TrollStore + bagbak + ipsw + Frida+objection + ldid+theos
(ipsw / bagbak / objection / Frida / TrollStore are the five absolute essentials, all actively maintained)

## Escalation Criteria / Blockers
- Target is Flutter/Unity/RN → switch to the frameworks playbook (reFlutter/il2cpp/hermes are mostly cross-platform)
- Jailbreak detection crashes → objection ios jailbreak disable, or hook fileExistsAtPath/fopen/canOpenURL/fork
- Can't find symbols when reversing system frameworks → extract the dyld_shared_cache with ipsw first
- No dedicated iOS Frida MCP → use the generic frida-mcp
