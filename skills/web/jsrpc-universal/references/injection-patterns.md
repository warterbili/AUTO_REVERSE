# 注入模式：控制台 / 油猴 / mitm 网络层注入

RPC 能不能稳，一半取决于"客户端怎么进到目标环境、待多久、能不能在反调试下活着"。三种从轻到重的注入方式。

## 1. 控制台手动注入（最快、最不稳）

适合一次性验证、找函数入口。

1. 打开目标站点，F12 控制台。
2. 粘贴 `JsEnv_Dev.js` 全文（定义 `HlClient`）。
3. `var c = new HlClient("ws://127.0.0.1:12080/ws?group=demo")`。
4. `c.regAction("sign", (r,p)=>r(window.getSign(p)))`。

缺点：**刷新即失效**；很多站点有反调试（`debugger` 死循环 / 检测 devtools），一开 F12 就崩。控制台注入仅用于探路。

> 探路技巧：函数入口未知时，先用 `/execjs` 在真实环境里跑表达式定位（`(function(){return typeof window.getSign})()`），确认后再 `regAction`。

## 2. 油猴脚本注入（推荐，持久）

把客户端固化成 Tampermonkey 脚本，页面一加载就自动连 + 注册，免去每次手粘、且能赶在站点反调试之前。

```javascript
// ==UserScript==
// @name         jsrpc-inject
// @match        https://target.example.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function () {
    // —— 此处粘贴 JsEnv_Dev.js 全文（HlClient 定义）——

    function boot() {
        var c = new HlClient("ws://127.0.0.1:12080/ws?group=demo&clientId=tab-"+Date.now());
        // 等目标算法挂到 window 后再注册（有的算法异步加载）
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

要点：
- `@run-at document-start` 抢在站点脚本前注入，规避部分 devtools/断点检测。
- 算法函数可能**异步加载**或藏在闭包里——用轮询等它出现，或 hook 到对应模块后再注册。
- 闭包里的私有函数取不到时：在油猴里 hook 定义处（改写 webpack chunk / `Function.prototype` / 目标对象属性），把私有函数引用提到外层再 `regAction`。

## 3. mitm 网络层注入（最强，可绕反调试 + 复用登录态）

本项目作者 `warterbili/BossZhipin_reverse` 的 **mitm-rpc** 模式：在网络层用 mitmproxy patch 掉反调试 JS，并把 RPC poller 注入页面，让 Python 远程驱动**已登录的真实浏览器**发请求。

```
你的脚本 ──HTTP──▶ 本地 FastAPI ──任务队列──▶ 浏览器(已登录) ──fetch──▶ 目标站点
                       ▲
                 mitm 在网络层 patch 反调试 JS + 注入 RPC poller
```

适用与优势：
- 站点有**强反调试**（`debugger`/devtools 检测）——网络层在 JS 落地前就改写它，比控制台/油猴更隐蔽。
- 需要**真实 TLS 指纹 + sec-ch-ua + cookie 漂移 + 登录态**全部原生处理（如 BOSS `__zp_stoken__`、瑞数 URL 后缀）——直接让真浏览器 `fetch`，不伪造任何东西。
- 与本仓库 `mitm-capture` / `cdp-browser` skill 组合使用：mitm 负责注入/patch，cdp 负责驱动真实 Chrome。

代价：搭建复杂（mitm CA 证书、脚本注入规则、任务队列），但一旦跑通最稳、可扩展到任意站点（写一个 `sites/<name>/` 插件即可）。

## 4. Android 注入（Sekiro）

- **frida**（推荐，免改包）：frida 脚本里 `new SekiroClient({sekiroGroup, clientId})` + `registerAction`，在 `Java.perform` 里调 hook 到的真方法。走 Frida Socket API，不需 USB relay。
- **Xposed**（需 root/虚拟框架）：模块里 `new SekiroClient(group, uuid).setupSekiroRequestInitializer(...).start()`，`registerSekiroHandler` 注册 `ActionHandler`。
- 注入时机：等目标类加载完（attach 到目标进程 / 在合适 hook 点再注册），避免方法未初始化就被调用。

## 选型一句话

- 探路 / CTF 一次性 → 控制台。
- 长期稳定单站 → 油猴 `document-start`。
- 强反调试 + 复用登录态 + 多站扩展 → mitm 网络层注入（BossZhipin_reverse 模式）。
- Android → Sekiro frida（优先）/ Xposed。
