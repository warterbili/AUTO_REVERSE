# Decision Tree: Fingerprint → Analysis Chain

After the brain obtains `fingerprint.json` in Phase 1, it uses this table to route the target to a specific playbook and skill sequence. **Match top-down and take the first rule that hits.**

## Android

```
Is it packed? (Application=stub / tiny dex / matches a known packer .so)
├─ Yes → [unpack] android-unpacking → return to Phase 1 and re-fingerprint
└─ No ↓

Is the TARGET a known 3rd-party anti-bot / risk SDK? (scan dex+lib for SDK fingerprints) —
this takes PRECEDENCE over the framework branch below: the SDK token lives in native Java/.so
independent of the app framework (a RN/Flutter app can still bundle a native-Java Castle SDK).
├─ io.castle.android / X-Castle-Request-Token   → skill: castle-reverse (covers the Android-native SDK directly)
├─ PerimeterX (_px*, px-cloud.net)               → skill: px-reverse
├─ Akamai bundled in-app (sensor_data, _abck)    → skill: akamai-reverse → catalog: akamai-bmp-generator (mobile BMP)
├─ DataDome / Geetest / others                   → see the Web vendor table (same skills cover the mobile SDK variant)
└─ no dedicated anti-bot SDK (target is the app's OWN signing) ↓

Framework? (scan lib/<abi>/) — answers "where is the app's own API logic"
├─ libflutter.so + libapp.so      → playbook: android-flutter   (reFlutter/blutter; jadx is useless)
├─ libhermes.so + *.bundle         → playbook: android-rn-hermes (hermes-dec)
├─ libil2cpp.so                    → playbook: android-unity     (frida-il2cpp-bridge)
└─ Only classes.dex (native)       ↓

Where is the core logic? (statically scan signing/encryption call sites)
├─ Pure Java/Kotlin (no native calls)    → playbook: android-java-sign   (jadx → hook to confirm → reproduce)
└─ Calls native (System.loadLibrary + JNI) → playbook: android-native-sign (jadx locates the boundary → capa → ghidra → unidbg)

Stacked protections (orthogonal to the above — add them on when hit):
├─ SSL pinning (OkHttp/NSC)  → dynamic bypass via frida-mitm-capture; or static apk-mitm
├─ RASP (root/frida/ptrace detection) → device-side Shamiko/vector + objection root disable; stealth injection via ZygiskFrida
└─ Heavy obfuscation (R8/control flow) → android-re-decompile name recovery; deflat for native flattening
```

## Web

`skill:` = bundled skill under `skills/web/`; `catalog:` = fillable entry in `catalog/web.yaml` (fetched on demand). Match top-down, first hit wins.

```
Step 0 — Transport layer (whenever the client is non-browser):
├─ 403/blocked only on requests/httpx/urllib but a real browser works → TLS/JA3/JA4 or HTTP2 fingerprinting
│     → impersonating client: catalog curl-cffi (Python) / tls-client-go (Go) / curl-impersonate
└─ plain HTTP works ↓

Step 1 — Identify the bot-protection vendor by fingerprint (first match wins):
├─ _px3/_px2 cookie, px-cloud.net, collector POST            → skill: px-reverse  (pure-algo _pxN)
├─ _abck / bm_sz / ak_bmsc / sbsd cookie, sensor_data POST   → skill: akamai-reverse
│     └─ mobile app/API target → catalog: akamai-bmp-generator (working BMP sensor generator)
├─ cf_clearance cookie, Turnstile widget, /cdn-cgi/challenge → catalog: flaresolverr (challenge proxy) | turnstile-solver | cloudflare-turnstile-solver-rs | cloudscraper
├─ datadome cookie, dd= params, geo.captcha-delivery.com     → catalog: datadome-generator | datadome-encryption
├─ HTTP 412 + $_ts.cd / $_ts.nsd (Ruishu / Rivers Security)  → skill: ruishu-reverse
├─ X-Castle-Request-Token / x-castle-client-id / __cuid      → skill: castle-reverse
├─ Geetest gt3/gt4 slider/click (gt.js, *.geetest.com)       → catalog: geekedtest-geetest-v4 | geetest-crack | geetest-v3-click-crack
└─ none of the above ↓

Step 2 — Captcha challenge present?
├─ image / slider / text OCR (esp. Chinese captchas)  → catalog: ddddocr (+ ddddocr-captcha-server)
├─ reCAPTCHA / hCaptcha / Turnstile widget            → catalog: nopecha-extension (multi-solver)
└─ none ↓

Step 3 — Do requests carry a signature / encrypted parameter (X-Bogus, sign, _signature, token…)?
├─ No  → web-api-analyzer captures a HAR; compile the endpoint list + auth method. Done.
└─ Yes → locate the signing function, then REPRODUCE it:
   1. Locate : cdp-browser hooks the real Chrome (no webdriver fp) to find the signing fn.
   2. Deobf : if the JS is obfuscated/packed → catalog webcrack (AST unbundle/deobfuscate) first.
   3. Reproduce — pick by cost / stability:
      ├─ algorithm tractable & stable           → pure-algo rewrite (Python/JS). Cheapest at scale.
      ├─ too hard / drifts fast / needs live env → skill: jsrpc-universal (call the real fn over RPC; low-mid QPS)
      └─ run the obfuscated JS headless in Node (high QPS, no browser) → environment supplementation:
         ├─ auto-detect what's missing via recursive Proxy + AI loop → skill: env-supplement-proxy (auto environment supplementation / environment emission)
         ├─ jsdom template bridge for a specific SDK              → skill: node-bridge-build
         └─ ready framework (Ruishu VMP etc.)                    → catalog: sdenv / qxVm / boda_jsEnv ; escalate to cdp-browser at the ceiling

Browser automation (orthogonal — when you need a real session / anti-detect driver):
└─ catalog: cdp-browser (bundled) → nodriver → botbrowser (strongest stealth, multi-target)
```

## iOS

`skill:` = bundled (ios-app-re); `catalog:` = fillable in catalog/ios.yaml. Needs a target iOS device (jailbroken, or sideload tooling for jailed).

```
Step 0 — Get a DECRYPTED binary (App Store apps are FairPlay-encrypted):
├─ jailbroken            → catalog: frida-ios-dump | bagbak | dumpdecrypted  (pull decrypted .ipa / Mach-O)
├─ no jailbreak          → catalog: ipatool (download) + trollstore/sidestore sideload ; flexdecrypt/bfdecrypt on-device
└─ already decrypted ↓

Step 1 — Static surface (skill: ios-app-re)
├─ class metadata  → catalog: class-dump (ObjC) | dsdump / swiftdump (Swift type metadata)
├─ disasm/decompile → catalog: hopper ; or skill: ghidra-reverse-engineering / ida-reverse-engineering
└─ Output: endpoints[], classes[], candidate signing methods

Step 2 — Dynamic instrumentation (skill: objection-ios + frida)
├─ SSL pinning / jailbreak / anti-debug → catalog: objection-ios (unpin) | frida-ios-hook ; r2frida for live memory
├─ hook the signing method → confirm in→out
└─ Output: crypto_io[] samples

Step 3 — Reproduce / patch (the brain)
├─ pure ObjC/Swift signing  → reproduce in Python/Swift
├─ native Mach-O/.dylib algo → escalate to Native (capa → ghidra/ida → reproduce)
├─ Flutter iOS (libapp.so)  → same as playbook android-flutter; capture at BoringSSL
└─ resign + inject dylib    → catalog: optool / insert-dylib + ldid ; theos for tweaks

→ playbook: ios-app
```

## Windows

`skill:` = bundled (windows-pe-re); `catalog:` = fillable in catalog/windows.yaml.

```
Step 0 — Fingerprint (catalog: detect-it-easy) → language / compiler / packer ↓

Step 1 — Packed? (UPX / Themida / VMProtect, high entropy, tiny imports)
├─ Yes → unpack: run + dump from memory → catalog: pe-sieve + hollows-hunter (dump) → scylla (rebuild imports) → re-fingerprint
└─ No ↓

Step 2 — Language?
├─ .NET (managed)  → catalog: dnspyex (decompile/debug/edit) | ilspy ; de4dot to deobfuscate first
└─ native C/C++    → skill: ghidra-reverse-engineering / ida-reverse-engineering (static); catalog: x64dbg + scyllahide (dynamic, anti-anti-debug) | windbg

→ playbook: windows-pe ; skill: windows-pe-re
```

## Native / binary (.so · ELF · Mach-O · PE · DEX-native)

Shared escalation target for Android-native-sign, iOS native, Windows native, and any standalone binary. Pick by ACTIVITY; full inventory is `catalog/native.yaml` (select by `when_to_use`).

```
1. Triage / identify  → catalog: capa-triage (capabilities; arm64 needs capa-rules + --backend ghidra) · flare-floss (deobf strings — **PE/shellcode only, not ELF/.so**) · yara-x · detect-it-easy (PE)
2. Disassemble / decompile (pick one you have) →
   ├─ skill: ghidra-reverse-engineering (free, MCP-drivable) | ida-reverse-engineering (best decompiler)
   └─ catalog: binary-ninja · radare2 / rizin · cutter
3. Deobfuscate / deflatten / unpack → catalog: d810-ng · goomba (Hex-Rays OLLVM) · novmp (VMProtect) · unipacker · upx
4. Emulate / run the algorithm →
   ├─ Android .so + JNI → skill: unidbg-emulation (+ jni-env-patching)
   └─ generic → catalog: qiling · unicorn-engine · flare-emu ; symbolic exec → angr · triton
5. Diff for patch / N-day → catalog: bindiff · diaphora · ghidriff
6. (optional) LLM-assisted → catalog: llm4decompile · reverser-ai · ghidrassist
```

## MCP — let the AI drive the tool directly (orthogonal to every section above)

Whenever a step above needs a tool AND an MCP server exists for it, PREFER the MCP: it turns "generate a command" into an autonomous read→act loop the agent runs itself. Full inventory `catalog/mcp.yaml` (select by `when_to_use`); key mappings:

```
decompile/RE : jadx→jadx-mcp-server-zinja|jadx-ai-mcp · ghidra→ghidra-mcp-lauriewired · ida→ida-pro-mcp · binja→binary-ninja-mcp · radare2→radare2-mcp · apktool→apktool-mcp-server
debug        : x64dbg→x64dbg-mcp-bromoket · windbg→mcp-windbg
dynamic/hook : frida→frida-mcp · android-frida→kahlo-mcp · il2cpp→il2cpp-frida-mcp
web/pentest  : burp→burp-mcp-portswigger · nmap/sqlmap/ffuf→mcp-for-security-cyproxio · metasploit→metasploit-mcp-gh05tcrew · nuclei→nuclei-mcp-addcontent · full Kali→kali-mcp · orchestrated→hexstrike-ai
traffic      : wireshark→wireshark-mcp · pcap→sample-pcap-analyzer-mcp · mitmproxy→mitmproxy-mcp-lucasoeth · HAR→har-mcp · browser net→chrome-devtools-mcp-benjaminr
malware      : remnux→remnux-mcp-server · all-in-one→arkana-malware-mcp
```

## Web app / API pentest — recon · content & API discovery · fuzzing (authorized only)

Active testing (distinct from anti-bot RE above). Pick a tool by task; full inventory in `catalog/web.yaml` + `catalog/native.yaml`, or drive the whole toolbox via `catalog: kali-mcp` (sandboxed container).

```
content / path / dir discovery → catalog: ffuf · feroxbuster · gobuster · dirsearch   (wordlists: seclists · leaky-paths)
API route discovery            → catalog: kiterunner (OpenAPI-derived) · katana ; JS endpoint mining → hakrawler · gau · linkfinder
HTTP parameter discovery       → catalog: arjun · x8 · paramspider
API spec fuzzing (REST/GraphQL)→ catalog: schemathesis · restler · apifuzzer · graphql-cop
protocol / coverage fuzzing    → catalog: boofuzz · afl++ · honggfuzz · radamsa   (native.yaml)
vuln templates / orchestration → catalog: nuclei (nuclei-mcp) · hexstrike-ai (agent-orchestrated) · mcp-for-security (suite)
```

## Escalation Criteria (feedback-loop triggers)
- Static analysis finds an encrypted field but can't locate its plaintext source → escalate to Dynamic (hook).
- Dynamic analysis shows the signature is computed in native code → escalate to the **## Native / binary** section (capa → ghidra/ida → unidbg/qiling).
- The native algorithm contains device-dependent callbacks and needs batch reproduction → patch the unidbg environment (jni-env-patching).
- Any tool step would benefit from an autonomous read→act loop → drive it via its MCP server (**## MCP** section / `catalog/mcp.yaml`).
