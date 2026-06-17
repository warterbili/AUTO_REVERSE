---
name: apk-acquire
description: Fully automatic APK acquisition for Android reversing. Given a package name, it obtains the APK through the first route that works — pull from a connected adb device, use a local file, or download from APKPure's direct-link endpoint (XAPK with splits or single APK) — then optionally installs it back to a device and verifies the package name. This is Phase 0 (Intake) of the auto_reverse orchestrator: it answers "I don't have the APK yet, get it for me" without manual confirmation. Trigger terms: get the apk, download apk, acquire apk, pull apk, apk 自动获取, 下载apk, 安装apk, app 没装/本地没有.
---

# APK Acquire — Phase 0 Intake helper

## When to Trigger

The orchestrator (or the user) names an Android target by **package name** (or app
name) but there is **no APK on disk yet**. Run this skill immediately, **without
asking the user** — acquisition is meant to be fully automatic.

This skill was added after the DailyPay case exposed that Phase 0 had no defined
"acquire" step (see that case's SKILL-GAPS note).

## Acquisition order (the script tries these in turn)

```
1. device  → app already installed on a connected adb device
             adb shell pm path <pkg>  → adb pull base + every split.apk
             (closest to a real install; best when frida/mitm comes next)
2. local   → an .apk/.xapk you already have (pass --local PATH)
3. apkpure → download from APKPure direct link, XAPK first then single APK:
             https://d.apkpure.com/b/XAPK/<pkg>?version=latest
             returns a zip (PK\x03\x04); XAPK = base.apk + config.*.apk + manifest.json
```

After acquiring, the script **verifies** the base APK's real package name (via aapt
if available) and can **install** it back to a device with `--install`
(`install-multiple` for split APKs).

## Standard usage (Claude runs this)

```bash
# auto route (device → local → apkpure), output into the workspace source dir
python skills/android/apk-acquire/scripts/acquire_apk.py com.DailyPay.DailyPay \
    --out workspace/<target>/00-source

# force a route / pin a version / install onto device / use a local file
python .../acquire_apk.py <pkg> --source apkpure --version latest
python .../acquire_apk.py <pkg> --source device            # pull installed app
python .../acquire_apk.py <pkg> --local C:\path\app.xapk    # use a file you have
python .../acquire_apk.py <pkg> --install                  # also install to device
```

The script prints a JSON summary (last line of stdout), e.g.:

```json
{
  "package": "com.DailyPay.DailyPay",
  "source": "apkpure",
  "files": ["...xapk", ".../com.DailyPay.DailyPay.apk", ".../config.arm64_v8a.apk", ...],
  "base_apk": ".../com.DailyPay.DailyPay.apk",
  "verified": true,
  "detected_package": "com.DailyPay.DailyPay",
  "installed": null,
  "out_dir": "..."
}
```

Then hand `base_apk` (+ split list) to the next phase (jadx / apktool fingerprint).

## Notes & gotchas

- **Pure stdlib** — no pip deps. Needs `adb` for the device/install routes (auto-located,
  incl. the Windows SDK path); `aapt` is optional (only for package verification).
- **XAPK = split APKs**. For decompilation you mostly need `base.apk`; for installing
  on a device you need **all** splits together (`install-multiple`). The script keeps both.
- **Third-party mirror risk**: APKPure repackages installers. The script enforces a
  `package_name == requested` check; for high-assurance work also compare the signing
  certificate against a known-good source, and prefer the **device pull** route when the
  app can be installed from an official store first.
- **Only a package id is needed.** If you only know the app's display name, resolve the
  package first (store search / web) — this skill is package-name-centric by design.
- **Robust alternative**: `apkeep` (Rust, multi-source: APKPure / Google Play / F-Droid)
  is a good `bundled:false` upgrade if the curl/urllib direct link breaks on a future
  APKPure change.
