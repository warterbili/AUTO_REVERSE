# Brain Dry-Run Trace — dailypay-castleio-android

> Regression check: take this case's `fingerprint.json` as input and walk it through the
> `brain/SKILL.md` 7 phases + `brain/decision-tree.md`, confirming that every routing endpoint
> genuinely exists and that we hit no dead ends. Date 2026-06-18.

## Input (fingerprint.json summary)
- Target: `com.DailyPay.DailyPay v48.0.0` (Android, unpacked, classes..classes9.dex complete)
- Framework shell: React Native + Hermes + Expo (`libhermes.so` + `index.android.bundle` 12.3MB)
- **Task goal**: Castle.io anti-scraping token `X-Castle-Request-Token`; the SDK is in **native Java** `io.castle.android` (suspected v2.9.0)
- Side paths: ThreatMetrix (device fp, out of scope), libthemis_jni.so (Themis crypto), rootbeer + libtoolChecker (suspected RASP)

## Phase-by-phase trace

| Phase | Decision | Routing endpoint | Exists? |
|---|---|---|---|
| 0 Intake | `.apk` → android | — | ✓ |
| 1 Fingerprint | unpacked; **third-party risk-control SDK = io.castle.android (takes priority over framework branch)** | **skill: castle-reverse** | ✓ |
| | (the shell is RN Hermes, but the Castle token is not in the Hermes bundle — the framework branch yields) | playbook android-rn-hermes (only when extracting the app's own JS API) | ✓ |
| 2 Plan | choose castle-reverse + android-java-sign style jadx chain | castle-reverse / android-java-sign | ✓ |
| 3 Static | jadx decompile io.castle.android, read the createRequestToken assembly chain | jadx-reverse-engineering / android-re-decompile | ✓ |
| 4 Dynamic | frida hook createRequestToken to confirm in→out; ssl/root side paths | frida-hooking / frida-mitm-capture / objection-runtime | ✓ |
| 4 side path | RASP (rootbeer + libtoolChecker) → orthogonal countermeasure | decision-tree Android "Stacked protections" | ✓ |
| side path | Themis/native libs if deeper digging is needed → Native segment | capa-triage → ghidra-reverse-engineering | ✓ |
| 5 Synthesize | reproduce the token; castle-reverse covers v3.1.1 android-native + web v11 | castle-reverse generator | ✓* |

\* Whether v2.9.0 matches castle-reverse's existing implementation must be verified per target — this is a **target-specificity** issue, not a routing dead end.

## Gap found and fixed (the value of the dry-run)

**Problem**: The Android segment originally routed only by "framework" and "core-logic location", with **no rule for "the target is a third-party risk-control SDK"**.
In this case the shell is RN Hermes, so under the original `Framework?` branch it would be sent to `android-rn-hermes`, while the
`castle-reverse` skill that can actually handle Castle (explicitly supporting `io.castle.android`) was only reachable from the **Web segment** — yet an Android target would never go look at the Web segment.
→ Misrouting / hidden dead end.

**Fix** (this commit):
1. In `decision-tree.md`, in the Android segment, after "packed?" and before "Framework?", added the **highest-priority**
   "is the target a known third-party anti-bot / risk-control SDK" branch: io.castle.android→castle-reverse, PerimeterX→px-reverse,
   Akamai→akamai-reverse, everything else→Web vendor table. Made explicit that "the SDK token is in native Java/.so, unrelated to the RN/Flutter shell,
   and takes priority over the framework branch".
2. In `brain/SKILL.md`, the Phase 1 Android fingerprint matrix gained a "third-party risk-control SDK" row, marked as taking priority over the framework row.

## Conclusion
After the fix, this case's full 7-phase walkthrough has **no dead ends**, and every routing endpoint (skill/playbook/catalog) was programmatically verified to exist.
The last item in section 5 of the original optimization plan, "end-to-end dry-run", is achieved.
