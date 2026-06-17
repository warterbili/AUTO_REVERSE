# 补环境框架对比 + 选型指南

> 配合 [`../SKILL.md`](../SKILL.md)。这里逐项展开 7 个框架的路线/能力/局限/安装坑，给选型决策树。
> 信息来自各仓库 README/源码，标注了各自原话里的关键能力，非记忆杜撰。

---

## 逐框架详解

### 1. pysunday/sdenv（+ sdenv-jsdom + sdenv-extend）— 公开补环境天花板

- **路线**：站在 jsdom 肩膀上的运行时补环境框架。专用 fork **sdenv-jsdom**（复刻 jsdom 27.0.1）提供强 DOM 仿真；**sdenv-extend** 提供 node 端与真浏览器共用的环境处理插件（battery/connection/cookie/window 代理等 handler，链式 `getHandle('battery')(...)`）。
- **核心 API 极简**：只有一个 `browser(window, type)` —— 传入 window 和浏览器类型（目前 Chrome 支持，Firefox/Safari 未支持），自动把浏览器特性集成进 window。
- **能力亮点**：作者称**固定随机数 + 加 sdenv-extend 插件后，瑞数 vmp 代码在 sdenv 跑出的 cookie 与浏览器一致**。`sdenv-extend` 能缓存原始值（`sdenv.memory.window`）、判断运行环境（`config.isNode`/`envType`）、提供 `wrapFunc`/`monitor` 工具。`window` handler 支持 `windowGetterUndefinedKeys`/`windowGetterErrorKeys`/`windowGetterWinKeys` 精细控制属性读取行为。
- **用法**：npm（`npm i sdenv`）/ docker（内置 `check` 命令验证某站是否适用）/ 源码 / 全局 / npx（`npx sdenv <网站>` 直接验证）。
- **代价 / 坑**：要编译 node 插件 → **node-gyp + Python + C 环境（Windows 装 VS 勾"使用 C++ 的桌面开发"，Mac 装 Xcode）**。**Node 版本挑剔**：v20.19.5/v22/v23/v24/v25 ✅，**v21.7.3 ❌**。DOM 重、起步成本高。

> 定位：**接受编译成本、要打瑞数等强对抗**时的首选。`node-bridge-build` 把它列为升级后手也是这个原因。

### 2. ylw00/qxVm — 纯 JS 轻量、学原理

- **路线**：基于 node16 + vm2，**纯 JS** 设计的补环境框架；内部用**弱引用**避免内存回收问题，优化实例产生方式。
- **用法**：`QXVM_GENERATE.QXVm_sanbox(js_code, '导出函数名', user_config)`。`user_config.isTest=true` 固定时间戳/随机数（**调试 diff 神器**）；`compress` 针对检测格式化的站；`runConfig.proxy/logOpen` 控制代理与日志；`env` 传 canvas/plugin/navigator/location/document。封装了浏览器事件主动调用 `lwVm.callListener('load')`、`protectAddIsTrusted`（给 event 加 isTrusted）、自定义 log、nodeServer 起 API。
- **代价 / 坑**：作者明说**开源版没有动态 DOM 解析**，框架内部 DOM 操作"不可信"，DOM 要自己重写（见仓库 `z_working/rs4.js`）。检测点覆盖相对少（作者定位为"前期版本，检测点比较少"）。最新支持瑞数/阿里/腾讯的版本**未开源**。
- **定位**：**学 Proxy/沙箱原理、轻量站点、需要固定时序调试**时好用。

### 3. bnmgh1/NodeSandbox 与 bnmgh1/node-sandbox — 魔改 V8，打硬检测

- **路线**：**魔改 Node/V8 源码** + 套 jsdom。把过检测的能力下沉到 C++/V8 层，所以**底层定义的方法天然不需要考虑 toString 检测**，且比 JS 的 `defineProperty` 快很多。
- **杀手级 API**（V8 层，纯 JS 做不到）：
  - `defineProperty(obj, key, {value, mode})` —— `mode` 位掩码强改描述符：`READ_ONLY=1 | DONT_ENUM=2 | DONT_DELETE=4`，`7`=全 false，`0`=全 true；**即使 configurable:false 也能强改后 delete**。
  - `setUndetectable(obj)` —— 把对象 `typeof` 强制成 `'undefined'`（做 `document.all` 的唯一正解）。
  - `SetNative(fn)`（node-sandbox 的 `wanfeng.SetNative`）/ `myToString`（NodeSandbox 的 `cbb_wf.myToString`）—— 函数 `toString` 在底层返回 `[native code]`，且不导致内存无法回收。
  - `setImmutableProto(obj)` —— 改 `__proto__` 报错（window/location 真实行为）。
  - `stack_intercept` / `Utils.Error_get_stack` —— **底层拦截堆栈**，清掉补环境自身的帧。
  - `defineIstrusted(event)` / `ClearMemory()`（主动 GC，无限建 vm 也稳）/ `getContext`（区分上下文）/ `newDocument`/`newLocation`/`init`/`initWorker`。
- **机制**：node 底层埋一层拦截器，`window` get document → 走 `globalMy.window_get_document`；`document.createElement` → 走 `globalMy.Document_createElement`（原型方法用类名前缀）。创建节点时用壳对象映射 jsdom 对象过检测。
- **代价 / 坑**：**开源只有"空架子"无任何产品样例**；**只编了 Windows 版**（macOS/Ubuntu 未编/慎更新，老代码可能跑不起来）；魔改 node 维护成本高；默认重写 Promise（用原生要调 `rePromise`）；**遇到未定义方法 node 会直接挂掉**（要补全）。
- **定位**：**纯 JS/jsdom 撞天花板**（document.all、toString/stack 穿透）时的硬解。

### 4. xuxiaobo-bobo/boda_jsEnv — 成熟 env 框架（文档少）

- **路线**：国内常见的 env 补环境框架之一（boda 系）。
- **坑**：README **几乎只有免责声明 + 联系方式**，没有公开用法文档，靠源码/作者群。评估成本高。
- **定位**：知道有这么个选项即可；除非有现成经验，否则优先文档齐全的 sdenv/lasawang。

### 5. lasawang/js-sandbox-env-framework — 与本 skill 最贴合 ⭐

- **路线**：基于 Node.js VM 的完整沙箱，**专为 JS 逆向设计**，直接命中本 skill 主题：
  - **指纹配置系统**：一个 JSON 控制全套指纹（Navigator/Screen/Window/Location/DOM/Canvas/WebGL/Audio），一键切设备身份（默认 profile = Chrome 120 + Win10 + NVIDIA RTX 3060）。
  - **自动检测模式** `--detect`：**自动报告脚本缺失的 API 并给加载建议**（= 本 skill 自动补全循环第 2~3 步）。
  - **代理监控** `--proxy`：完整 Proxy 追踪，记录所有属性访问和方法调用（= "吐环境"）。
  - **AI 辅助补环境**：自动生成缺失 API 的补环境代码。
  - **反检测**：webdriver=false、toString 保护、无 bot 特征泄露。
  - 性能：7866 行混淆代码 18ms 执行完成。
- **用法**：`node standalone-runner.js --profile default script.js`；`--detect` 先分析缺啥；`--profile-file ./my-device.json` 自定义指纹；编程 API `SimpleSandbox.injectEnvironment('env/bom/navigator.js')`。还带 Web 管理界面（`npm start` → :3000）。
- **代价 / 坑**：纯 VM 路线仍有 V8 层天花板（document.all 等纯 JS 做不彻底）；Node ≥18。
- **定位**：**学技术 + 半自动补环境 + 指纹 profile 化**的首选起点。

### 6. decodecaptcha/Browser-Env — 代理到真浏览器（免补环境）

- **路线**：不造轮子，封装集成现成开源项目，提供多档"真浏览器/V8"执行：
  - `chrome_remote` / `chrome_remote_pro`：用 `--remote-debugging-port` 启动真 Chrome，CDP 客户端连 `debuggerAddress` —— 命令行启动**天然无 webdriver 特征**，绕过自动化检测（"辛苦抠的 js 再也不用花几小时补环境"）。
  - `browserenv` / `wirebrowserenv`（带网络拦截改包）/ `wirebrowserenv_uc`（集成 undetected-chromedriver，不触发 Distill/Imperva/DataDome/Botprotect）。
  - `v8env`（PyMiniRacer，最小 V8，只跑纯 JS）；`jsenv`（nodejs + jsdom/canvas 异步/同步补环境）。
- **依赖 / 坑**：Windows、Python 3.6+、selenium 3.4+、Chrome 92+、selenium-wire、undetected-chromedriver；UC 要 `version_main` 对齐本机 Chrome 版本。
- **定位**：**补环境过不去时的逃生路线**——直接执行真实浏览器免补环境，代价是慢、重、QPS 低。本质和 `cdp-browser` 同类。

### 7. warterbili/node-crawler-env-utils — 第一方"吐环境"监控工具 ⭐（本仓库 owner 自有）

- **路线**：基于 Proxy 的**环境代理监控工具**，专做自动补全循环的"收集缺口"环节。
- **能力**：`setEnvProxy({ paths, ... })` 一行拦 **12 种 Proxy 操作**（get/set/has/deleteProperty/ownKeys/getOwnPropertyDescriptor/defineProperty/preventExtensions/getPrototypeOf/setPrototypeOf/apply/construct）；**5 级日志**（ERROR~TRACE）彩色输出、`maxDepth`、`showStackTrace`、`customFormatter`；`deepProxyPaths` 深度递归代理；`ignoredProperties` 忽略 `__proto__`/`constructor` 防自伤；`enableApply`/`enableConstruct` 控制函数/构造拦截。TypeScript，`npm i crawler-env-utils`。
- **定位**：**第一方首选的"吐环境"工具**——跑 SKILL 自动补全循环第 2~3 步（让环境吐出缺啥、记录每次访问）。它**不是过检测的成品环境**，要配合上面的成品框架（sdenv/lasawang）补值过检测。

---

## 选型决策树

```
要补环境？
├─ 只想看"脚本到底查了啥 / 缺了啥"（吐环境）
│     → warterbili/node-crawler-env-utils（第一方）  +  lasawang --detect
│
├─ 学技术 / 要指纹 profile 化 / 半自动 + AI 辅助
│     → lasawang/js-sandbox-env-framework（最贴合）
│        想更轻、要固定时序调试 → ylw00/qxVm
│
├─ 直接干活、目标是瑞数等强对抗、能接受编译成本
│     → pysunday/sdenv (+ sdenv-jsdom + sdenv-extend)
│
├─ 撞 V8 层硬检测（document.all / toString·stack 穿透）
│     → bnmgh1/NodeSandbox 或 node-sandbox（魔改 V8）
│
└─ 补环境投入产出比太低 / 要 100% 真 / 偶尔调用
      → cdp-browser（真 Chrome）/ jsrpc-universal（调真实算法）
         / decodecaptcha/Browser-Env（代理到真浏览器）
```

## 能力矩阵（速查）

| 框架 | 路线 | DOM 仿真 | 自动报缺 | 指纹 profile | V8 层过检测 | 文档/样例 | 安装难度 |
|---|---|---|---|---|---|---|---|
| sdenv | jsdom fork+插件+C++ | 强（jsdom27） | check 命令 | extend handler | 部分(C++) | 好 | 高（编译）|
| qxVm | 纯 JS + vm2 | 弱（要自写） | log | env 传值 | 否 | 中（公众号）| 低 |
| NodeSandbox/node-sandbox | 魔改 V8 + jsdom | jsdom | 否 | 否 | **强** | 差（空架子）| 高（限 Win）|
| boda_jsEnv | env 框架 | ? | ? | ? | ? | **差（仅免责）** | ? |
| lasawang | Node VM+Proxy | 全覆盖 | **--detect** | **JSON 一键** | 否 | **好** | 低（Node18）|
| Browser-Env | 真浏览器/V8 | 真浏览器 | N/A（免补） | 真浏览器 | N/A（真的）| 中 | 中（selenium/UC）|
| node-crawler-env-utils | Proxy 监控 | N/A | **吐缺口** | 否 | 否 | 好 | 低（npm）|

> 没有"全 ✅"的框架。**组合用**：node-crawler-env-utils/lasawang 吐缺口 + sdenv/NodeSandbox 过检测 + cdp-browser 取真值 + 撞天花板就换真浏览器。
