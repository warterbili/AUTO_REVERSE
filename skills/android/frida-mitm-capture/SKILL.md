---
name: frida-mitm-capture
description: Fully automated Android HTTPS capture skill built on Frida + mitmproxy. Injects an SSL bypass script via attach mode (defeating conscrypt / OkHttp CertificatePinner / NetworkSecurityConfig) and forwards traffic to mitmproxy over adb reverse USB forwarding, saving it as JSONL. Use cases: (1) capturing an Android app's HTTPS traffic; (2) analyzing the API requests triggered by a given action (parameters, signatures, encrypted fields); (3) locating the API when you don't know which endpoints a feature calls. Trigger terms: traffic capture, Frida MITM, SSL bypass, HTTPS decryption, API reversing, certificate pinning bypass.
---

# Frida MITM Fully Automated Capture Skill

## When to Trigger

When the user needs to:
- Capture an Android app's HTTPS traffic
- Analyze the API requests triggered by a given action (parameters, signatures, encrypted fields)
- Find out which endpoints a feature calls

Use this skill immediately, without asking the user.

---

## How It Works

```
Frida attaches to the running app
  └─ Injects ssl_bypass.js
       ├─ Proxy routing: System properties + ConnectivityManager + ProxySelector enumeration
       └─ SSL bypass: conscrypt + OkHttp3 CertificatePinner + NetworkSecurityConfig
            └─ All HTTPS traffic → mitmproxy (decrypted) → saved as JSONL
adb reverse tcp:8080 tcp:8080 (USB forwarding, no WiFi dependency)
```

**Note: use attach mode, not spawn** (spawn frequently times out and fails).

---

## Standard Workflow (Steps Claude Performs)

> **Preferred: use the wrapper scripts (cross-platform, works on Windows / macOS / Linux).**
> `start_capture.py` / `stop_analyze.py` already handle cross-platform adaptation (temp directory, ANSI colors, and process cleanup are all dispatched per platform automatically). Use them first; do not type the raw commands below by hand.

### Phase 1: Start Capture (wrapper script)

```bash
python start_capture.py -p <package_name>
# Optional: -o <session_dir>  --port 8080  --host 127.0.0.1
```

The script automatically: detects ADB → sets up `adb reverse` USB forwarding → configures the device proxy → checks/starts frida-server → starts mitmproxy → injects ssl_bypass.js to launch the app, and writes the PID/config to `<session>/session.info`.

**→ Tell the user: The app has launched. Perform the action you want to capture on the phone, then let me know when you're done.**

### Phase 2: Wait for the User's Action

Keep waiting and do nothing until the user says "done" / "finished".

### Phase 3: Stop and Clean Up + Analyze (wrapper script)

```bash
python stop_analyze.py -o <session_dir>
# Optional: --full to show full request/response bodies   --filter /api/order to view a single path only
```

The script automatically stops Frida/mitmproxy, clears the device proxy, removes the `adb reverse` forwarding, and parses `<session>/captured.jsonl` to produce an analysis report.

---

### Platform Notes

- **Default session directory**: no longer hard-coded to `/tmp`; uses the system temp directory instead (Windows = `%TEMP%\mitm_session`, POSIX = `/tmp/mitm_session`). Override with `-o`.
- **Windows / PowerShell**: just run `python start_capture.py` / `python stop_analyze.py` as shown above. Internally the scripts already use `taskkill` instead of `pkill` and enable ANSI colors via `ctypes`. The three commands `adb` / `frida` / `mitmdump` must be on PATH (pip-installed `frida-tools` and `mitmproxy` land in `Scripts\` automatically).

### Manual Commands (fallback only, when the scripts are unavailable)

<details>
<summary>POSIX (bash)</summary>

```bash
# Start
mitmdump --listen-port 8080 -s mitm_addon.py --set session_dir=/tmp/<session> --set ssl_insecure=true -q &
adb reverse tcp:8080 tcp:8080
adb shell settings put global http_proxy 127.0.0.1:8080
PID=$(adb shell "ps -A | grep <package_name>" | awk '{print $2}' | head -1)
frida -U -p $PID -l ssl_bypass.js &
# Stop
pkill -f "frida -U"; pkill -f mitmdump
adb shell settings delete global http_proxy
adb reverse --remove tcp:8080
```
</details>

<details>
<summary>Windows (PowerShell)</summary>

```powershell
# Start (use Start-Process for background processes)
Start-Process mitmdump -ArgumentList '--listen-port','8080','-s','mitm_addon.py','--set',"session_dir=$env:TEMP\<session>",'--set','ssl_insecure=true','-q'
adb reverse tcp:8080 tcp:8080
adb shell settings put global http_proxy 127.0.0.1:8080
$PID_ = (adb shell "ps -A | grep <package_name>").Split()[1]
Start-Process frida -ArgumentList '-U','-p',$PID_,'-l','ssl_bypass.js'
# Stop (taskkill instead of pkill)
taskkill /F /IM frida.exe; taskkill /F /IM mitmdump.exe
adb shell settings delete global http_proxy
adb reverse --remove tcp:8080
```
</details>

---

## Parameters

| Parameter | Description | Default |
|------|------|--------|
| `-p / --package` | Target app package name, e.g. `com.example.app` | Required |
| `-o / --output` | Session directory (where captured data is saved) | `mitm_session` under the system temp directory (Win=`%TEMP%`, POSIX=`/tmp`) |
| `--port` | mitmproxy listen port | `8080` |

---

## Prerequisites

- An ADB device is connected
- Frida server is running on the device (the name may be `frida-server`, `fff`, or another custom name)
- The host has installed: `frida-tools`, `mitmproxy` (`pip install frida-tools mitmproxy`)
- The three executables `adb` / `frida` / `mitmdump` are on PATH
- **Windows**: the scripts are already cross-platform; just run `python start_capture.py` directly under PowerShell / cmd

---

## ssl_bypass.js Coverage

Proxy routing (from httptoolkit/frida-interception-and-unpinning):
- `java.lang.System` system-property locking (prevents the app from resetting the proxy config)
- `ConnectivityManager.getDefaultProxy` override
- `Java.enumerateMethods` enumerates all ProxySelector implementations and forces routing

SSL Pinning Bypass:
- `conscrypt.TrustManagerImpl.verifyChain` (null guard to prevent WebView NPE)
- `conscrypt.TrustManagerImpl.checkTrustedRecursive`
- `android.security.net.config.NetworkSecurityConfig` pin set cleared
- `android.security.net.config.NetworkSecurityTrustManager.checkServerTrusted` (handles both the 2-arg void and the 3-arg List overloads)
- `okhttp3.CertificatePinner` (check / check$okhttp / b obfuscated variants)
- `com.android.okhttp.CertificatePinner` (Android built-in v2)
- `okhttp3.internal.tls.OkHostnameVerifier`
- `javax.net.ssl.HttpsURLConnection` (setDefaultHostnameVerifier / setSSLSocketFactory)
- `android.webkit.WebViewClient.onReceivedSslError`
- native `libssl.so` SSL_CTX_set_verify

---

## Common Issues and Known Fixes

| Issue | Cause | Fix |
|------|------|------|
| Frida spawn timeout | The app has launch protection, or spawn mode is unstable | Switch to attach mode (launch the app first, then attach) |
| `--no-pause` error | Frida 17+ removed this parameter | Drop `--no-pause` |
| `mitmproxy.net.http encoding` ImportError | The mitmproxy API changed in newer versions | Remove that import; mitmproxy decompresses automatically |
| Traffic bypasses the proxy (OkHttp ignores the system proxy) | OkHttp does not read the system proxy by default | ssl_bypass.js already solves this via ProxySelector enumeration |
| adb reverse loss interrupts traffic | adb reverse is not restored automatically after the app restarts | Re-run `adb reverse tcp:8080 tcp:8080` after every app restart |
| App crash: `checkServerTrusted expected List` | Some TrustManagers' 3-arg version returns `List<X509Certificate>` instead of void | That overload requires `return Java.use('java.util.Arrays').asList(chain)` |
| App crash: `access violation 0x0` | A dynamically scanned checkServerTrusted hook returns a type that doesn't match what native expects | Don't do a dynamic full-scan of TrustManagers; use precise static hooks |
| App crash: `verifyChain NPE` (WebView) | WebView passes a null chain to verifyChain | The verifyChain hook needs a null guard and should return an empty ArrayList |
| ProxySelector.select returns an incompatible value | A list object is pre-built outside the hook, and Frida's bridge fails to identify its type | Create a new list on each call inside the implementation |
| AndroidNetworkLibrary ClassNotFound | That class lives in WebView's separate ClassLoader, not the app DEX | Ignore the ClassNotFound; it does not affect capture |

---

## Validated on Real Apps (Anonymized)

Below are representative scenarios distilled after running this approach successfully against real production apps (anonymized, not pointing to any specific vendor):

| Scenario | Symptom | Corresponding Fix |
|------|------|---------|
| An OkHttp app (ignores the system proxy) | The app uses OkHttp and does not read the system proxy by default, so an ordinary system proxy captures no traffic | ssl_bypass.js forces routing via `ProxySelector` enumeration |
| An app with a WebView | When WebView goes through `verifyChain` it passes a null chain, causing an NPE crash | The verifyChain hook adds a null guard and returns an empty ArrayList |
