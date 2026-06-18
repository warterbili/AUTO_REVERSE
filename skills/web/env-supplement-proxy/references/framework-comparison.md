# Environment Supplementation Framework Comparison + Selection Guide

> Use together with [`../SKILL.md`](../SKILL.md). This expands, item by item, the route/capabilities/limitations/installation pitfalls of 7 frameworks, and gives a selection decision tree.
> The information comes from each repo's README/source, with each one's key capabilities noted in its own words, not invented from memory.

---

## Per-Framework Details

### 1. pysunday/sdenv (+ sdenv-jsdom + sdenv-extend) — the Public Environment-Supplementation Ceiling

- **Route**: a runtime environment-supplementation framework standing on jsdom's shoulders. A dedicated fork **sdenv-jsdom** (a re-implementation of jsdom 27.0.1) provides strong DOM simulation; **sdenv-extend** provides environment-handling plugins shared between the node side and a real browser (battery/connection/cookie/window proxy and other handlers, chained `getHandle('battery')(...)`).
- **Minimal core API**: just one `browser(window, type)` —— pass in window and the browser type (currently Chrome is supported, Firefox/Safari are not) and it automatically integrates browser features into window.
- **Capability highlights**: the author says that **with fixed random numbers + the sdenv-extend plugins, the cookie that Ruishu vmp code produces under sdenv matches the browser**. `sdenv-extend` can cache original values (`sdenv.memory.window`), judge the runtime environment (`config.isNode`/`envType`), and provide `wrapFunc`/`monitor` tools. The `window` handler supports `windowGetterUndefinedKeys`/`windowGetterErrorKeys`/`windowGetterWinKeys` for fine-grained control of property-read behavior.
- **Usage**: npm (`npm i sdenv`) / docker (with a built-in `check` command to verify whether a given site is applicable) / source / global / npx (`npx sdenv <website>` to verify directly).
- **Cost / pitfalls**: you must compile a node addon → **node-gyp + Python + a C toolchain (on Windows install VS with "Desktop development with C++" checked; on Mac install Xcode)**. **Picky about the Node version**: v20.19.5/v22/v23/v24/v25 ✅, **v21.7.3 ❌**. Heavy DOM, high startup cost.

> Positioning: the **first choice when you accept the compilation cost and need to beat strong adversaries like Ruishu**. This is also why `node-bridge-build` lists it as the upgrade fallback.

### 2. ylw00/qxVm — Pure-JS, Lightweight, for Learning the Principles

- **Route**: an environment-supplementation framework designed in **pure JS** on node16 + vm2; internally it uses **weak references** to avoid memory-reclamation issues and optimizes how instances are produced.
- **Usage**: `QXVM_GENERATE.QXVm_sanbox(js_code, 'exportedFunctionName', user_config)`. `user_config.isTest=true` fixes timestamps/random numbers (**a debugging-diff godsend**); `compress` targets sites that detect formatting; `runConfig.proxy/logOpen` control proxying and logging; `env` passes canvas/plugin/navigator/location/document. It wraps actively dispatching browser events `lwVm.callListener('load')`, `protectAddIsTrusted` (adding isTrusted to events), custom log, and nodeServer to start an API.
- **Cost / pitfalls**: the author explicitly says **the open-source version has no dynamic DOM parsing**, the framework's internal DOM operations are "untrustworthy", and the DOM must be rewritten by you (see `z_working/rs4.js` in the repo). Detection-point coverage is relatively low (the author positions it as "an early version with relatively few detection points"). The latest version supporting Ruishu/Alibaba/Tencent is **not open-sourced**.
- **Positioning**: good for **learning Proxy/sandbox principles, lightweight sites, and when you need fixed-timing debugging**.

### 3. bnmgh1/NodeSandbox and bnmgh1/node-sandbox — Modified V8, for Beating Hard Detection

- **Route**: **modified Node/V8 source** + wrapping jsdom. It pushes detection-passing capability down to the C++/V8 layer, so **methods defined at the low level naturally don't need to consider toString detection**, and it's much faster than JS's `defineProperty`.
- **Killer APIs** (V8 layer, impossible in pure JS):
  - `defineProperty(obj, key, {value, mode})` —— `mode` bitmask force-changes the descriptor: `READ_ONLY=1 | DONT_ENUM=2 | DONT_DELETE=4`, `7`=all false, `0`=all true; **even with configurable:false you can force-change and then delete**.
  - `setUndetectable(obj)` —— force the object's `typeof` to `'undefined'` (the only correct way to do `document.all`).
  - `SetNative(fn)` (node-sandbox's `wanfeng.SetNative`) / `myToString` (NodeSandbox's `cbb_wf.myToString`) —— the function `toString` returns `[native code]` at the low level, without preventing memory reclamation.
  - `setImmutableProto(obj)` —— make changing `__proto__` throw (the real behavior of window/location).
  - `stack_intercept` / `Utils.Error_get_stack` —— **intercept the stack at the low level**, clearing out the supplemented environment's own frames.
  - `defineIstrusted(event)` / `ClearMemory()` (active GC, stable even building infinite vms) / `getContext` (distinguishing contexts) / `newDocument`/`newLocation`/`init`/`initWorker`.
- **Mechanism**: a layer of interceptors is buried in node's internals; `window` get document → goes through `globalMy.window_get_document`; `document.createElement` → goes through `globalMy.Document_createElement` (prototype methods use a class-name prefix). When creating nodes, shell objects map to jsdom objects to pass detection.
- **Cost / pitfalls**: **the open source is only an "empty skeleton" with no product samples whatsoever**; **only a Windows build is compiled** (macOS/Ubuntu aren't compiled / update with caution, old code may not run); the modified node has high maintenance cost; Promise is rewritten by default (to use the native one call `rePromise`); **when an undefined method is hit, node simply crashes** (you must supplement it).
- **Positioning**: the hard solution when **pure JS/jsdom hits the ceiling** (document.all, toString/stack penetration).

### 4. xuxiaobo-bobo/boda_jsEnv — a Mature env Framework (Sparse Docs)

- **Route**: one of the env environment-supplementation frameworks common in China (the boda lineage).
- **Pitfalls**: the README is **almost only a disclaimer + contact info**, with no public usage documentation, relying on the source/the author's group. Evaluation cost is high.
- **Positioning**: just know this option exists; unless you have prior experience with it, prefer the well-documented sdenv/lasawang.

### 5. lasawang/js-sandbox-env-framework — the Closest Fit for This Skill ⭐

- **Route**: a complete sandbox based on the Node.js VM, **designed specifically for JS reversing**, hitting this skill's theme directly:
  - **Fingerprint configuration system**: one JSON controls the entire fingerprint set (Navigator/Screen/Window/Location/DOM/Canvas/WebGL/Audio), with one-click device-identity switching (default profile = Chrome 120 + Win10 + NVIDIA RTX 3060).
  - **Automatic detection mode** `--detect`: **automatically reports the script's missing APIs and gives loading suggestions** (= steps 2~3 of this skill's auto-completion loop).
  - **Proxy monitoring** `--proxy`: full Proxy tracing, recording all property accesses and method calls (= "environment disclosure").
  - **AI-assisted environment supplementation**: automatically generates supplementation code for missing APIs.
  - **Anti-detection**: webdriver=false, toString protection, no bot-feature leakage.
  - Performance: 7866 lines of obfuscated code executed in 18ms.
- **Usage**: `node standalone-runner.js --profile default script.js`; `--detect` analyzes what's missing first; `--profile-file ./my-device.json` for a custom fingerprint; programmatic API `SimpleSandbox.injectEnvironment('env/bom/navigator.js')`. It also comes with a web admin UI (`npm start` → :3000).
- **Cost / pitfalls**: the pure-VM route still has a V8-layer ceiling (document.all etc. can't be done thoroughly in pure JS); Node ≥18.
- **Positioning**: the preferred starting point for **learning the technique + semi-automatic environment supplementation + fingerprint profiling**.

### 6. decodecaptcha/Browser-Env — Proxy to a Real Browser (No Environment Supplementation)

- **Route**: doesn't reinvent the wheel; it wraps and integrates existing open-source projects, offering several tiers of "real browser / V8" execution:
  - `chrome_remote` / `chrome_remote_pro`: launch real Chrome with `--remote-debugging-port`, and a CDP client connects to `debuggerAddress` —— a command-line launch is **naturally free of webdriver features**, bypassing automation detection ("the JS you painstakingly extracted never needs hours of environment supplementation again").
  - `browserenv` / `wirebrowserenv` (with network interception and packet modification) / `wirebrowserenv_uc` (integrating undetected-chromedriver, not triggering Distill/Imperva/DataDome/Botprotect).
  - `v8env` (PyMiniRacer, minimal V8, only runs pure JS); `jsenv` (nodejs + jsdom/canvas, async/sync environment supplementation).
- **Dependencies / pitfalls**: Windows, Python 3.6+, selenium 3.4+, Chrome 92+, selenium-wire, undetected-chromedriver; UC requires `version_main` to align with the local Chrome version.
- **Positioning**: the **escape route when environment supplementation can't pass**—execute directly in a real browser with no environment supplementation, at the cost of being slow, heavy, and low-QPS. Essentially in the same category as `cdp-browser`.

### 7. warterbili/node-crawler-env-utils — First-Party "Environment Disclosure" Monitoring Tool ⭐ (Owned by This Repo's Owner)

- **Route**: a Proxy-based **environment-proxy monitoring tool**, specialized for the "collect the gaps" stage of the auto-completion loop.
- **Capabilities**: `setEnvProxy({ paths, ... })` intercepts **12 kinds of Proxy operations** in one line (get/set/has/deleteProperty/ownKeys/getOwnPropertyDescriptor/defineProperty/preventExtensions/getPrototypeOf/setPrototypeOf/apply/construct); **5 log levels** (ERROR~TRACE) with colored output, `maxDepth`, `showStackTrace`, `customFormatter`; `deepProxyPaths` for deep recursive proxying; `ignoredProperties` to ignore `__proto__`/`constructor` to prevent self-harm; `enableApply`/`enableConstruct` to control function/construct interception. TypeScript, `npm i crawler-env-utils`.
- **Positioning**: the **preferred first-party "environment disclosure" tool**—for running steps 2~3 of the SKILL's auto-completion loop (letting the environment disclose what's missing and recording every access). It is **not a detection-passing finished environment**; it must be paired with the finished frameworks above (sdenv/lasawang) to supplement values and pass detection.

---

## Selection Decision Tree

```
Need environment supplementation?
├─ Just want to see "what the script actually queried / what's missing" (environment disclosure)
│     → warterbili/node-crawler-env-utils (first-party)  +  lasawang --detect
│
├─ Learning the technique / want fingerprint profiling / semi-automatic + AI-assisted
│     → lasawang/js-sandbox-env-framework (closest fit)
│        Want it lighter, need fixed-timing debugging → ylw00/qxVm
│
├─ Just getting the job done, target is a strong adversary like Ruishu, can accept the compilation cost
│     → pysunday/sdenv (+ sdenv-jsdom + sdenv-extend)
│
├─ Hitting V8-layer hard detection (document.all / toString·stack penetration)
│     → bnmgh1/NodeSandbox or node-sandbox (modified V8)
│
└─ Environment supplementation ROI too low / want 100% real / occasional calls
      → cdp-browser (real Chrome) / jsrpc-universal (call the real algorithm)
         / decodecaptcha/Browser-Env (proxy to a real browser)
```

## Capability Matrix (Quick Reference)

| Framework | Route | DOM simulation | Auto-report gaps | Fingerprint profile | V8-layer detection passing | Docs/samples | Install difficulty |
|---|---|---|---|---|---|---|---|
| sdenv | jsdom fork+plugins+C++ | Strong (jsdom27) | check command | extend handler | Partial (C++) | Good | High (compile) |
| qxVm | pure JS + vm2 | Weak (write your own) | log | env values | No | Medium (WeChat blog) | Low |
| NodeSandbox/node-sandbox | modified V8 + jsdom | jsdom | No | No | **Strong** | Poor (empty skeleton) | High (Windows only) |
| boda_jsEnv | env framework | ? | ? | ? | ? | **Poor (disclaimer only)** | ? |
| lasawang | Node VM+Proxy | Full coverage | **--detect** | **One-click JSON** | No | **Good** | Low (Node18) |
| Browser-Env | real browser/V8 | real browser | N/A (no supplementation) | real browser | N/A (it's real) | Medium | Medium (selenium/UC) |
| node-crawler-env-utils | Proxy monitoring | N/A | **discloses gaps** | No | No | Good | Low (npm) |

> There's no "all ✅" framework. **Combine them**: node-crawler-env-utils/lasawang to disclose gaps + sdenv/NodeSandbox to pass detection + cdp-browser to obtain real values + switch to a real browser when you hit the ceiling.

## Addendum (June 2026 dedicated collection, all already added to the catalog)

For the full list see `tmp/collection/proxy-auto-env.md` (86 deduplicated entries). New finds worth looking at first:

| Framework | Highlight | When to choose |
|---|---|---|
| **happy1256/Youzi-Mask** | a modular rewrite; dual switches `IS_PROXY` (first-level monitoring to see direct access) + `IS_RECURSION_PROXY` (recursive monitoring to see multi-level access), exactly corresponding to this skill's recursive-Proxy method | when you want ready-made "recursive proxy + tiered monitoring" switches, new and active (June 2026); its predecessor happy1256/youzi_js_env has more stars |
| **lwjjike/xbsJsEnv** | the Xiaoboshi framework: automatically intercepts global objects' get/set/has/delete/enumerate/define/getOwnPropertyDescriptor + BOM/DOM method-call interception | when you want "full property-access interception / environment disclosure" and ongoing maintenance (★58, April 2026) |
| **RuoShui-0014/js-env** | based on a modified isolated-vm, with a built-in **non-standard proxy + native function creation**; `rsvm.get/set` read/write properties **without triggering accessors** (anti-detection) | when the target detects Proxy/accessor traces, use the invisible proxy at the isolated-vm layer (★108) |
| ipylei/jsVmEnv, ConlinH/pyv8env | vm2/isolated-vm sandbox + call-stack localization of the missing environment; pyv8 for the Python side | leans toward the VM-sandbox route / when you need Python integration |

> The selection principle is unchanged: **first disclose the gaps (Youzi-Mask/xbsJsEnv/node-crawler-env-utils) → when you need anti-detection go to the isolated-vm family (RuoShui-0014/NodeSandbox) → obtain real values / hit the ceiling and switch to cdp-browser**.
