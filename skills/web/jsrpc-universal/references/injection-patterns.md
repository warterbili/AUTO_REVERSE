# Injection patterns: console / Tampermonkey / mitm network-layer injection

Half of whether RPC is reliable comes down to "how the client gets into the target environment, how long it stays, and whether it can survive anti-debugging". Three injection methods, from lightest to heaviest.

## 1. Manual console injection (fastest, least stable)

Suitable for one-off validation and finding function entries.

1. Open the target site, F12 console.
2. Paste the entire `JsEnv_Dev.js` (defines `HlClient`).
3. `var c = new HlClient("ws://127.0.0.1:12080/ws?group=demo")`.
4. `c.regAction("sign", (r,p)=>r(window.getSign(p)))`.

Drawbacks: **lost on refresh**; many sites have anti-debugging (`debugger` infinite loops / devtools detection) that crashes the moment you open F12. Console injection is only for probing.

> Probing tip: when the function entry is unknown, first use `/execjs` to run an expression in the real environment to locate it (`(function(){return typeof window.getSign})()`), then `regAction` once confirmed.

## 2. Tampermonkey script injection (recommended, persistent)

Bake the client into a Tampermonkey script so the page auto-connects + registers as soon as it loads, avoiding repeated manual pasting and getting in ahead of the site's anti-debugging.

```javascript
// ==UserScript==
// @name         jsrpc-inject
// @match        https://target.example.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function () {
    // —— Paste the entire JsEnv_Dev.js here (HlClient definition) ——

    function boot() {
        var c = new HlClient("ws://127.0.0.1:12080/ws?group=demo&clientId=tab-"+Date.now());
        // Wait until the target algorithm is attached to window before registering (some algorithms load asynchronously)
        var t = setInterval(function () {
            if (window.getSign) {
                clearInterval(t);
                c.regAction("sign", (resolve, param) => resolve(window.getSign(param)));
            }
        }, 200);
    }
    boot();
})();
```

Key points:
- `@run-at document-start` injects ahead of the site's scripts, evading some devtools/breakpoint detection.
- The algorithm function may **load asynchronously** or hide inside a closure — poll until it appears, or register after hooking the corresponding module.
- When you can't reach a private function inside a closure: hook at the definition site within Tampermonkey (rewrite the webpack chunk / `Function.prototype` / the target object's property), lift the private function reference out to an outer scope, then `regAction`.

## 3. mitm network-layer injection (most powerful, bypasses anti-debugging + reuses login state)

The **mitm-rpc** pattern from this project author's `warterbili/BossZhipin_reverse`: at the network layer, use mitmproxy to patch out the anti-debugging JS and inject the RPC poller into the page, letting Python remotely drive an **already-logged-in real browser** to send requests.

```
Your script ──HTTP──▶ local FastAPI ──task queue──▶ browser (logged in) ──fetch──▶ target site
                       ▲
                 mitm patches anti-debugging JS + injects the RPC poller at the network layer
```

When to use it and its advantages:
- The site has **strong anti-debugging** (`debugger`/devtools detection) — the network layer rewrites it before the JS lands, more covert than the console/Tampermonkey.
- You need **real TLS fingerprint + sec-ch-ua + cookie drift + login state** all handled natively (e.g. BOSS `__zp_stoken__`, the Ruishu URL suffix) — just let the real browser `fetch`, forging nothing.
- Used in combination with this repo's `mitm-capture` / `cdp-browser` skills: mitm handles injection/patching, cdp drives the real Chrome.

Cost: complex to set up (mitm CA certificate, script injection rules, task queue), but once it works it is the most stable and can be extended to any site (just write a `sites/<name>/` plugin).

## 4. Android injection (Sekiro)

- **frida** (recommended, no repackaging): in the frida script `new SekiroClient({sekiroGroup, clientId})` + `registerAction`, calling the hooked real method inside `Java.perform`. Uses the Frida Socket API, no USB relay needed.
- **Xposed** (requires root/virtual framework): in the module `new SekiroClient(group, uuid).setupSekiroRequestInitializer(...).start()`, registering an `ActionHandler` via `registerSekiroHandler`.
- Injection timing: wait until the target class is loaded (attach to the target process / register at an appropriate hook point) to avoid the method being called before it is initialized.

## Selection in one sentence

- Probing / one-off CTF → console.
- Long-term stable single site → Tampermonkey `document-start`.
- Strong anti-debugging + reuse login state + multi-site extension → mitm network-layer injection (BossZhipin_reverse pattern).
- Android → Sekiro frida (preferred) / Xposed.
