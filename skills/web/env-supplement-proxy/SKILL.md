---
name: env-supplement-proxy
description: 用 ES6 Proxy 递归代理 + 访问日志做"自动补环境 / 自动吐环境"——把 globalThis/window/navigator/document 包成递归 Proxy，trap 住 get/set/has/getOwnPropertyDescriptor/deleteProperty，记录所有"被访问但未定义"的路径，配合 AI 循环（跑 → 抓 X is not defined / undefined 访问 → 补 stub → 再跑 → 直到输出稳定 → 与真浏览器样本 diff）半自动把 headless Node 里跑反爬/sign 混淆 JS 所缺的浏览器环境补齐。覆盖核心机制、自动补全循环、检测/反调试踩坑（Function.prototype.toString [native code] 完整性、toString/valueOf/Symbol.toPrimitive 强转、in/hasOwnProperty、属性描述符 getter vs value、navigator/screen/canvas/WebGL/timezone 指纹自洽、iframe/contentWindow、performance.now/Date 时序、UA/platform/webdriver 一致性、Proxy 经 toString/stack 泄漏），并给出框架选型表（sdenv / qxVm / NodeSandbox / boda_jsEnv / js-sandbox-env-framework / Browser-Env / node-crawler-env-utils）与升级到真浏览器的逃生路线。触发词：补环境、自动补环境、Proxy 补环境、吐环境、env 补全、window is not defined、navigator is not defined、document is not defined、jsdom、sdenv、浏览器环境模拟、headless 跑加密 JS、proxy hook 环境检测、缺啥补啥、纯 JS 补环境框架、AI 补环境。
languages: [zh, en]
---

# Proxy 自动补环境 / 自动吐环境 Skill

> **TL;DR**：补环境 = 让一段在浏览器里写、用了 `window`/`navigator`/`document` 的混淆 JS（反爬采集、sign、cookie 生成），能在 **Node 里裸跑**而不报 `X is not defined`。
> **自动补环境** = 不手撸每个 stub，而是把全局对象包成**递归 ES6 Proxy**，trap 住属性访问、**记录所有被访问但未定义的路径**，然后跑一个循环：跑 → 抓缺失 → 补一个合理值 → 再跑 → 直到输出稳定 → 与真浏览器 diff 校验。这就是"自动"和"吐环境"的含义（环境自己"吐"出它缺什么）。
>
> 诚实说在前面：**没有"一键补全任何站点"的银弹**。Proxy/jsdom 路线有天花板——遇到 `typeof document.all`、V8 层面的 toString/stack 检测、指纹自洽校验时会穿透。本 skill 教**技术本身 + 选型 + 何时该放弃补环境改走真浏览器**。

---

## 用户触发语句

- "这段加密 JS 一跑就 `window is not defined` / `navigator is not defined`，帮我补环境"
- "给 \<site\> 的采集脚本做个自动补环境，缺啥补啥"
- "Proxy 补环境 / 自动吐环境怎么搞"
- "jsdom 补不动了，有没有纯 JS 的补环境框架"
- "headless 在 Node 里跑这个 sign 算法，怎么把浏览器环境补出来"
- "selenium/CDP 太慢，想把算法搬到 Node 里补环境跑"

---

## 这是什么 + 何时用（决策先行）

把一段浏览器 JS 搬到 Node 里跑，它会立刻撞上"浏览器全局对象在 Node 不存在"：`window`、`document`、`navigator`、`screen`、`location`、`localStorage`、`XMLHttpRequest`…… **补环境**就是把这些缺的东西"喂"给它。

**两种补法**：
- **手撸（hand-stub）**：你一个一个加 `global.navigator = { userAgent: '...' }`。精确但极慢，且不知道脚本到底查了哪些。
- **自动（Proxy 路线，本 skill）**：用 Proxy 包住全局，让脚本自己访问，Proxy 帮你**把它访问过的、缺的路径全打印出来**，你只补它真查的。这就是 `node-bridge-build` 里 "jni-env-patching 4 步法：先看真环境再给合理值，只补 SDK 实际查的" 的自动化版本。

### 什么时候选 Proxy 自动补环境（vs 其它路线）

| 你的处境 | 选什么 | 为什么 |
|---|---|---|
| 算法不复杂，能完整逆出来 | **纯算**（手写 Python/JS 重实现） | 最快最稳，无环境依赖。能纯算就别补环境 |
| 算法太重/混淆太狠，逆不动，但 **QPS 要求高、要 headless 大规模跑** | **Proxy 自动补环境**（本 skill） | 不逆算法，直接把原 JS 喂进半自动补出的环境里跑，单进程吞吐远高于浏览器 |
| 页面/App 已经在跑，只要偶尔调一下算法 | **`jsrpc-universal`**（JsRpc/Sekiro RPC） | 直接调真实环境里的函数，免抠代码免补环境，但受真实端在线数与网络 RTT 限制，QPS 上不去 |
| 已有 jsdom 模板、目标是 PX/Akamai 这类已知 SDK | **`node-bridge-build`**（jsdom + 11 env 模块模板） | 有现成模板直接套，比从零 Proxy 快 |
| 补环境穿透/指纹自洽过不了，或就是要 100% 真 | **`cdp-browser`** 真 Chrome / **`jsrpc-universal`** | 真浏览器免补环境，代价是慢、重 |

> **一句话规则**：当你**必须在 Node 里 headless、大规模、跑一段逆不动的反爬/sign 混淆 JS**，而真浏览器/RPC 的 QPS 喂不饱、你又**不想手撸每个 stub** 时 —— 用 Proxy 自动补环境。

> 与 `node-bridge-build` 的关系：那个 skill 是"有 jsdom 模板时怎么套模板做 PX/Akamai bridge"；**本 skill 是模板背后的通用技术**——当你没有现成模板、面对任意站点、想让环境**半自动地自己吐出来**时用。两者可叠加：jsdom 兜底 DOM 仿真，Proxy 兜底"缺啥自动报"。

---

## 核心机制：递归 Proxy + 访问日志

补环境的"自动"靠一个**递归 ES6 Proxy**：把全局对象包起来，trap 住所有操作，**返回的对象再递归包一层**，这样无论脚本访问多深的路径（`window.navigator.connection.rtt`），每一层都能被记录。关键 trap：

- `get` —— 读属性。命中已定义的返回真值（再递归代理）；**未定义的记录路径并返回一个"占位 Proxy"**，避免立刻 `undefined`/报错中断。
- `set` —— 写属性。记录脚本往环境里塞了什么（常是它自己缓存的中间值）。
- `has` —— `'x' in window` / `with(window)` 作用域查找会走这里。**必须返回 `true`**，否则 `with` 块里裸写 `navigator` 会落到外层 → `is not defined`。
- `getOwnPropertyDescriptor` —— `Object.getOwnPropertyDescriptor` 检测会走这里，要给出**和真浏览器一致的描述符**（见 Gotchas）。
- `deleteProperty` / `ownKeys` / `defineProperty` —— 脚本枚举/删除/重定义属性时用，反爬常用 `Object.keys(navigator)` 比对。

最小但正确的"递归代理 + 访问日志"骨架：

```javascript
// recursive-env-proxy.js —— 教学版：跑通后看它"吐"出缺哪些路径
const missing = new Set();           // 收集"被访问但未定义"的路径

function makeProxy(target, path) {
  return new Proxy(target, {
    get(t, prop, recv) {
      // Symbol / 内部钩子直接放过，避免污染日志、避免破坏 Proxy 自身
      if (typeof prop === 'symbol') return Reflect.get(t, prop, recv);
      const full = path ? `${path}.${String(prop)}` : String(prop);

      if (prop in t) {
        const val = Reflect.get(t, prop, recv);
        // 只对对象/函数递归代理；原始值直接返回
        return (val && (typeof val === 'object' || typeof val === 'function'))
          ? makeProxy(val, full) : val;
      }
      // —— 关键：未定义就记录，并返回可继续链式访问的占位 Proxy ——
      missing.add(full);
      return makeProxy(function () {}, full);   // 既能当对象点下去，也能被当函数调用
    },
    set(t, prop, val) { return Reflect.set(t, prop, val); },
    has(t, prop) { return true; },                       // with(window){...} / 'x' in window 不漏到外层
    getOwnPropertyDescriptor(t, prop) {
      return Reflect.getOwnPropertyDescriptor(t, prop)
          ?? { configurable: true, enumerable: true, value: undefined };
    },
    deleteProperty(t, prop) { return Reflect.deleteProperty(t, prop); },
  });
}

// 用一个空壳当 window 起步，让脚本自己把缺口暴露出来
const fakeWindow = makeProxy({}, '');
globalThis.window = fakeWindow;
globalThis.self = fakeWindow;
globalThis.navigator = fakeWindow.navigator;
globalThis.document  = fakeWindow.document;

// ... 在这里 require/eval 目标混淆 JS ...

process.on('exit', () => {
  console.log('=== 被访问但未定义的路径（按这个补 stub）===');
  console.log([...missing].sort().join('\n'));
});
```

> ⚠️ 这个教学版**只用来"吐缺口"**，不能直接拿去过反爬：它的占位 Proxy 一被 `toString()`/`typeof`/描述符检测就穿帮。真正过检测要按 [`references/proxy-cookbook.md`](references/proxy-cookbook.md) 把每个检测点补对。

---

## 自动补全循环（这才是"自动"）

AI 应该把补环境当成一个**收敛循环**来跑，而不是一次写完：

```
┌─ 1. 注入 Proxy 环境（空壳 window/navigator/document）
│
├─ 2. 跑目标 JS
│      ├─ 抛 "X is not defined"        → 全局缺 X
│      ├─ 抛 "Cannot read ... of undefined" → 某路径中途断了
│      └─ 正常结束但 missing 集合有内容  → 这些是它查过但没值的路径
│
├─ 3. 对每个缺口补一个【合理值】（不是随便给）：
│      · 字符串类（userAgent/platform/语言）→ 抄真浏览器实测值
│      · 函数类（addEventListener/getContext）→ 给个返回合理值的 [native code] 壳函数
│      · 数值类（screen.width/devicePixelRatio）→ 抄真实分辨率
│      · 对象类 → 继续让 Proxy 递归吐下一层
│
├─ 4. 再跑 → 缺口变少 → 重复 2~4
│
├─ 5. 直到【输出稳定】：连续两轮 missing 不再新增、目标函数能产出结果
│
└─ 6. 【校验】与真浏览器样本 diff：同样输入，对比 Node 输出与真 Chrome 输出
       一致 → 收敛成功；不一致 → 缺口在"指纹自洽"层（见 Gotchas），不是缺 API
```

补 stub 的取值原则（沿用 `jni-env-patching` 的"先读真环境再给合理值"）：
- **能从真浏览器抓的值，就去抓**（用 `cdp-browser` 在真 Chrome 里读 `navigator.xxx`、`screen.xxx`、canvas 指纹），别凭空编。
- **凭空编的值要内部自洽**：UA 写 Windows 就别让 `navigator.platform` 是 `MacIntel`（见 Gotchas 自洽校验）。
- **函数 stub 默认返回"无害值"**：事件类返回 `undefined`、查询类返回空数组/空对象，先让脚本跑下去，再按它后续怎么用这个返回值精修。

成熟框架（sdenv / lasawang 框架）把第 2~3 步做成了 `--detect` 自动检测模式：跑一遍自动报告缺哪些 API 并给加载建议，你只需确认值。这就是"AI 辅助补环境"。

---

## ⚠️ Gotchas（最硬的部分：反爬专门检测补环境）

补环境跑不通，**九成不是缺 API，而是被检测出"这不是真浏览器"**。逐条排查：

1. **`Function.prototype.toString` 完整性检测（最常见）**
   反爬会 `fn.toString()`，真原生函数返回 `function xxx() { [native code] }`。你的 stub 用普通 JS 函数会返回真实源码 → 暴露。
   解决：壳函数必须让 `toString` 返回 `function xxx() { [native code] }`，且 **`toString` 自己也得过 `toString` 检测**（递归陷阱）。底层框架（NodeSandbox/node-sandbox 的 `SetNative`、sdenv 的 `wrapFunc`）在 C++/V8 层做，纯 JS 框架靠改写 `Function.prototype.toString` 拦截。**注意 `Function.prototype.toString.toString()` 也要是 native**。

2. **`toString` / `valueOf` / `Symbol.toPrimitive` 强制类型转换**
   `'' + navigator`、`navigator + 1` 会触发对象→原始值转换。Proxy 的 `get` 要正确响应 `Symbol.toPrimitive`、`toString`、`valueOf`，否则抛 `Cannot convert object to primitive value`，或转出来的字符串里露出 `[object Object]` / Proxy 痕迹。

3. **`in` 算子 + `hasOwnProperty` 不一致**
   你 `has` 全返回 `true`，但 `Object.prototype.hasOwnProperty.call(navigator, 'webdriver')` 走的是 `getOwnPropertyDescriptor`。两者结果对不上（`'x' in obj` 为真但拿不到描述符）→ 暴露。`has` 和 `getOwnPropertyDescriptor` 要协调。

4. **属性描述符 (configurable/enumerable/writable, getter vs value) 不匹配**
   真浏览器里 `navigator.userAgent` 是**原型上的 getter**（`get userAgent`），不是 `navigator` 自身的 value 属性；很多内置属性 `enumerable:false`、`configurable:true`。你直接 `navigator.userAgent = '...'` 给成 own value、enumerable:true → `Object.getOwnPropertyDescriptor` / `Object.keys` 一比就露。要在**原型链对应层**用 getter 定义，描述符抄真浏览器。(NodeSandbox 的 `defineProperty(mode)` / node-sandbox 的 `Utils.defineProperty` 就是为强改这些位存在的：`mode=7` = writable/enumerable/configurable 全 false。)

5. **navigator / screen / canvas / WebGL / timezone 指纹自洽**
   单个值对没用，要**整组自洽**：`userAgent`↔`platform`↔`oscpu`↔`appVersion`、`screen.width/height`↔`availWidth`↔`devicePixelRatio`、canvas/WebGL 渲染结果↔`WEBGL_debug_renderer_info`(显卡名)↔UA、`Intl.DateTimeFormat().resolvedOptions().timeZone`↔`Date.getTimezoneOffset()`↔IP 地理位置。**canvas/WebGL 指纹不能随机伪造**——要么用真实采集值（`cdp-browser` 抓），要么用框架的指纹 profile（lasawang 框架一个 JSON 控制全套指纹）。

6. **iframe / contentWindow / `document.createElement` trap**
   反爬常 `document.createElement('iframe')` 后取 `iframe.contentWindow` 拿一个"干净 window"来反查你有没有污染原型，或在 iframe 里重新取原始函数。createElement 要按 tagName 返回带正确原型的元素壳；contentWindow 要给一个自洽的子 window（不能直接回原 window，否则 `iframe.contentWindow === window` 暴露）。

7. **`performance.now` / `Date` 时序**
   行为检测算 `performance.now()` 差值、`Date.now()` 间隔。补环境里这些值要单调递增且数量级合理（别一直返回同一个常量，也别返回 Node 的真实 0.x ms 高精度——和浏览器节流后的精度不一样）。测试态可固定时间戳（qxVm 的 `isTest`、sdenv 固定随机数），生产态要给可信的递增时序。

8. **环境自洽：UA vs platform vs webdriver**
   `navigator.webdriver` 必须 `false`（且描述符要像原生）；UA、platform、`navigator.languages`、时区、`hardwareConcurrency`、`deviceMemory` 要像同一台真机。任一处对不上整组就废。

9. **Proxy 自身泄漏（最阴的）**
   - `fn.toString()` 露出 Proxy/壳代码（见 #1）。
   - 抛错时 `error.stack` 里出现你的 `recursive-env-proxy.js` 路径/`Proxy` 帧 → 反爬 try/catch 读 stack 就发现。框架要拦截 `Error.prepareStackTrace` / `Error.captureStackTrace`，清掉自己的帧（NodeSandbox 的 `stack_intercept`、node-sandbox 的 `Utils.Error_get_stack`）。
   - `typeof proxy` 对 callable Proxy 返回 `'function'`、对普通返回 `'object'`，但 `document.all` 在真浏览器是**唯一 `typeof === 'undefined'` 的对象**——纯 Proxy 做不出来，要 V8 层 `setUndetectable`（NodeSandbox/node-sandbox 提供）。这是纯 JS 补环境的**硬天花板**之一。
   - `Object.prototype.toString.call(navigator)` 应是 `[object Navigator]`，Proxy 包过的可能变 `[object Object]` → 要用 `Symbol.toStringTag` 修。

> 把 #1/#5/#9 看作三大杀手：toString 完整性、指纹自洽、Proxy 泄漏。这三个过不去，补再多 API 也没用。

---

## 框架选型表（诚实的 tradeoff）

逐项详见 [`references/framework-comparison.md`](references/framework-comparison.md)。速查：

| 框架 | 路线 | 适合 | 代价 / 局限 |
|---|---|---|---|
| **pysunday/sdenv** (+ sdenv-jsdom / sdenv-extend) | jsdom fork + 插件 + 部分 C++ | **公开补环境天花板**；瑞数 vmp 等，作者称固定随机+插件后 cookie 与浏览器一致 | 要编译 node 插件（node-gyp + VS/Xcode），Node 版本挑剔；DOM 重 |
| **ylw00/qxVm** | 纯 JS + vm2，弱引用 | 学原理、轻量、检测点少的站；`isTest` 固定时序好调试 | 开源版无动态 DOM 解析（DOM 要自己重写），检测点覆盖有限 |
| **bnmgh1/NodeSandbox** / **node-sandbox** | **魔改 Node/V8** + 套 jsdom | 要 V8 层能力（`SetNative`/`setUndetectable`/`defineProperty(mode)`/stack 拦截）打硬检测 | 开源是"空架子"无样例；只编了 Windows 版；魔改 node 维护成本高 |
| **xuxiaobo-bobo/boda_jsEnv** | env 框架 | 国内成熟 env 框架之一 | README 几乎只有免责声明，文档靠源码/作者 |
| **lasawang/js-sandbox-env-framework** | **Node VM + Proxy 监控 + 指纹 profile + AI 辅助补环境** | **与本 skill 最贴合**：递归 Proxy 追踪、`--detect` 自动报缺 API、一个 JSON 控全套指纹、webdriver=false/toString 保护 | 纯 VM 路线仍有 V8 层天花板（document.all 等）；Web 管理界面是加分非必须 |
| **decodecaptcha/Browser-Env** | **代理到真浏览器**（selenium/UC/CDP）+ 可选 jsdom | 补环境过不去时"免补环境"——直接执行真实浏览器 | 慢、重、QPS 低；本质是逃生路线不是补环境 |
| **warterbili/node-crawler-env-utils** | **Proxy 环境监控工具**（本仓库 owner 第一方） | **"吐环境"利器**：`setEnvProxy({paths})` 拦 12 种 Proxy 操作、彩色日志、深度代理、调用栈——专门用来跑自动补全循环第 2~3 步 | 是"监控/吐缺口"工具，不是"过检测的成品环境"；要配合上面的成品框架 |

**选型建议**：
- 想**学技术 / 看 Proxy 自动报缺**：先用第一方 **node-crawler-env-utils** 跑"吐环境"循环，配 **lasawang 框架** 的 `--detect` + 指纹 profile。
- 想**直接干活、目标是瑞数等强对抗**：上 **sdenv**（接受编译成本）。
- **碰到 V8 层硬检测**（`document.all`、toString/stack 穿透）：上 **NodeSandbox/node-sandbox** 的魔改 node。

### 逃生路线（撞天花板就别硬刚）

```
Proxy 自动补环境（本 skill）
   ↓ 指纹自洽过不了 / V8 层 document.all / toString·stack 穿透
sdenv（jsdom fork，公开 ceiling）
   ↓ 还是穿
NodeSandbox / node-sandbox（魔改 V8，setUndetectable / stack 拦截）
   ↓ 仍不值得（投入产出比太低）
真浏览器：cdp-browser（真 Chrome，免补环境）  或  jsrpc-universal（调真实环境里的算法）
   或  decodecaptcha/Browser-Env（代理到真浏览器）
```

> 判断"该升级"的信号：补了 50+ 个 stub 还在新增缺口、与真浏览器 diff 始终对不上、缺口集中在 canvas/WebGL/document.all/stack —— **这些是补环境天花板，不是你补得不够**。果断换真浏览器。

---

## Example（最短可用路径）

```bash
mkdir env-supplement && cd env-supplement
npm init -y
# 第一方"吐环境"监控工具（跑自动补全循环用）
npm install crawler-env-utils
# 需要 DOM 仿真时再加 jsdom
npm install jsdom
```

**第 1 步：先让环境"吐"出缺什么**（教学版 Proxy 或 node-crawler-env-utils）

```javascript
// run-and-collect.js
const { setEnvProxy, LogLevel } = require('crawler-env-utils');
setEnvProxy({
  paths: ['window', 'navigator', 'document', 'screen', 'location'],
  deepProxyPaths: ['window.navigator'],          // 递归深代理
  logConfig: { level: LogLevel.TRACE, showStackTrace: true },
});
// require / eval 你的目标混淆 JS：
const sign = require('./target_obfuscated.js');
try { console.log(sign.getToken('payload')); }
catch (e) { console.log('断在：', e.message); }   // 抓 X is not defined / of undefined
```

```bash
node run-and-collect.js
# 看日志里 [GET] 了哪些路径却拿不到值 → 这就是要补的清单
```

**第 2 步：迭代补 stub（围绕 "is not defined" 收敛）**

```javascript
// env.js —— 每轮把日志报缺的补上，值优先从真 Chrome（cdp-browser）抓
globalThis.navigator = Object.create(Navigator?.prototype ?? {});
Object.defineProperty(navigator, 'userAgent', {            // 原型 getter + 真实描述符
  get() { return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...'; },
  enumerable: false, configurable: true,
});
Object.defineProperty(navigator, 'webdriver', { get(){ return false; }, configurable:true });
// 函数 stub 要过 [native code] 检测：
function native(fn, name) {
  Object.defineProperty(fn, 'name', { value: name });
  fn.toString = () => `function ${name}() { [native code] }`;  // 真框架在 V8 层做，这里示意
  return fn;
}
globalThis.addEventListener = native(function addEventListener(){}, 'addEventListener');
```

```bash
# 第 3 步：再跑 → 缺口变少 → 重复第 2 步，直到稳定
node -r ./env.js run-and-collect.js
```

**第 4 步：与真浏览器 diff 校验**

```bash
# 同一份 payload，在真 Chrome 里跑 sign（用 cdp-browser skill），对比输出
# 一致 = 收敛；不一致且缺口在 canvas/WebGL/document.all = 撞天花板，走逃生路线
```

> 真正过强对抗别用上面的教学 `native()`——`toString` 自身会穿帮。改用 sdenv 的 `browser(window,'chrome')` 一把注入，或 NodeSandbox 的 V8 层 `SetNative`。教学版只用来理解循环。

---

## 别做的事

- ❌ **不要试图 mock 全部 browser API** —— 不可能也没必要。Proxy 自动报缺，**只补脚本实际查的**（`node-bridge-build` 同款原则）。
- ❌ **不要凭空编指纹值** —— UA/canvas/分辨率优先用 `cdp-browser` 从真 Chrome 抓；编的值九成自洽不了。
- ❌ **不要随机伪造 canvas/WebGL** —— 不能随机，必须真实采集或用框架指纹 profile。
- ❌ **不要用普通 JS 函数当 stub 就指望过检测** —— `toString` 一查就露，必须 `[native code]` 壳。
- ❌ **不要无脑递归代理一切** —— 代理 `Function.prototype` / `Object.prototype` / Symbol 会污染并自伤；忽略 `__proto__`/`constructor`/Symbol（node-crawler-env-utils 的 `ignoredProperties` 就是干这个）。
- ❌ **不要把凭据/代理账号 hardcode** —— 走 env var。
- ❌ **撞天花板还硬补** —— 缺口在 document.all/stack/canvas 自洽时，是天花板不是你菜，换真浏览器。

---

## 配套引用

| 文件 | 内容 |
|---|---|
| [`references/proxy-cookbook.md`](references/proxy-cookbook.md) | 递归 Proxy 代码模式 + 每个检测点（toString/[native code]、Symbol.toPrimitive、has/descriptor 协调、document.all、stack 清理、Symbol.toStringTag、iframe/contentWindow）的处理写法 + 自动补全循环脚手架 |
| [`references/framework-comparison.md`](references/framework-comparison.md) | 7 个框架逐项对比（路线/能力/局限/安装坑）+ 选型决策树 + 各自最适合的场景 |

相关 skill：取真值用 **`cdp-browser`**；有 PX/Akamai jsdom 模板用 **`node-bridge-build`**；不想补环境直接调真实算法用 **`jsrpc-universal`**；取值方法论复用 **`jni-env-patching`**（先读真环境再给合理值）。

---

## ❌ 不要踩的"自然语言陷阱"

1. **"补环境能一键搞定任何站"** —— 不能。有 V8 层天花板（document.all/toString/stack）。
2. **"缺啥补啥跑通就行"** —— 跑通 ≠ 过检测。要和真浏览器 diff 校验。
3. **"指纹随便填个能跑就行"** —— 错，整组要自洽，canvas 不能随机。
4. **"补环境一定比浏览器划算"** —— 只在 QPS 高、算法逆不动时划算；偶尔调用走 RPC/浏览器更省事。
5. **"Proxy 全返回 true / 占位对象就够了"** —— has/descriptor/toString/stack 任一不自洽就露。

---

*本 skill 基于对 pysunday/sdenv(+jsdom/extend)、ylw00/qxVm、bnmgh1/NodeSandbox 与 node-sandbox、xuxiaobo-bobo/boda_jsEnv、lasawang/js-sandbox-env-framework、decodecaptcha/Browser-Env、warterbili/node-crawler-env-utils 的 README/源码整理，机制与检测点来自这些框架的实际实现，非记忆杜撰。授权安全研究 / CTF / 教学用途。*
