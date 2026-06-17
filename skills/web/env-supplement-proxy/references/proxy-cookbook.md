# 递归 Proxy 补环境 Cookbook（代码模式 + 检测点处理）

> 配合 [`../SKILL.md`](../SKILL.md) 使用。这里是**可直接抄改的代码片段**：递归 Proxy 骨架、自动吐缺口、以及每个反爬检测点怎么补对。
> 教学/调试用纯 JS 写法；标注 **[需 V8 层]** 的项纯 JS 做不彻底，要上 NodeSandbox/node-sandbox 的魔改 node 或 sdenv 的 C++ 插件。

---

## 1. 递归 Proxy 骨架（带路径 + 缺口收集）

```javascript
const ACCESS = { missing: new Set(), get: new Set(), set: new Set() };
const IGNORE = new Set(['__proto__', 'constructor', 'prototype']);  // 别代理这些，会自伤

function proxify(target, path, opts = {}) {
  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop === 'symbol' || IGNORE.has(prop)) return Reflect.get(t, prop, recv);
      const full = path ? `${path}.${String(prop)}` : String(prop);
      ACCESS.get.add(full);
      if (prop in t || Reflect.getOwnPropertyDescriptor(t, prop)) {
        const v = Reflect.get(t, prop, recv);
        return (v && (typeof v === 'object' || typeof v === 'function')) ? proxify(v, full, opts) : v;
      }
      ACCESS.missing.add(full);
      if (opts.strict) throw new ReferenceError(`${full} is not defined`);  // 想精确定位时开
      return proxify(function stub() {}, full, opts);   // 占位：可继续点、可被调用
    },
    set(t, prop, v) { ACCESS.set.add(`${path}.${String(prop)}`); return Reflect.set(t, prop, v); },
    has() { return true; },                              // 见 §3
    getOwnPropertyDescriptor(t, prop) { return Reflect.getOwnPropertyDescriptor(t, prop); },
    deleteProperty(t, prop) { return Reflect.deleteProperty(t, prop); },
    ownKeys(t) { return Reflect.ownKeys(t); },
    getPrototypeOf(t) { return Reflect.getPrototypeOf(t); },
    apply(t, thisArg, args) { return Reflect.apply(t, thisArg, args); },
    construct(t, args) { return Reflect.construct(t, args); },
  });
}

function dumpMissing() {
  console.log('=== MISSING（按这个补）===\n' + [...ACCESS.missing].sort().join('\n'));
}
```

> 第一方工具 `warterbili/node-crawler-env-utils` 的 `setEnvProxy({ paths, deepProxyPaths, ignoredProperties, enableApply, enableConstruct })` 把这套封装好了（12 种 trap + 彩色日志 + 调用栈 + `maxDepth`），生产里直接用它跑收集，别重复造轮子。

---

## 2. `[native code]` / Function.prototype.toString 完整性 —— **杀手 #1**

反爬 `fn.toString()` 期望 `function name() { [native code] }`。普通 JS 函数会吐源码。

```javascript
// 纯 JS 近似：改写全局 toString，命中壳函数就返回 native 文本
const NATIVE = new WeakSet();
function asNative(fn, name = fn.name, len = fn.length) {
  Object.defineProperty(fn, 'name',   { value: name, configurable: true });
  Object.defineProperty(fn, 'length', { value: len,  configurable: true });
  NATIVE.add(fn);
  return fn;
}
const _toString = Function.prototype.toString;
const patched = function toString() {
  if (NATIVE.has(this)) return `function ${this.name}() { [native code] }`;
  return _toString.call(this);
};
// 关键：patched 自己也要过检测（toString.toString() 必须是 native）
NATIVE.add(patched);
Function.prototype.toString = patched;
```

**纯 JS 的漏洞（务必知道）**：
- `Function.prototype.toString === patched` 在某些检测里就是异常信号（真原生地址不同）。
- `Object.getOwnPropertyDescriptor(Function.prototype,'toString')` 的描述符可能露馅。
- 经 `iframe.contentWindow.Function.prototype.toString` 取到的是**未被改的原始版** → 你的壳函数立刻穿帮。

**[需 V8 层] 彻底解法**：NodeSandbox 的 `cbb_wf.myToString` / node-sandbox 的 `wanfeng.SetNative(fn)`、sdenv 的 `wrapFunc` —— 在引擎层把函数标记为 native，`toString` 检测天然通过，且 iframe 取原始版也安全。

---

## 3. `has` / `hasOwnProperty` / `in` 协调 —— 别让 `with` 漏出去也别自相矛盾

```javascript
has(t, prop) {
  // with(window){ navigator } 和 'x' in window 都走这里。
  // 全返 true 能防漏到外层 → 防 "navigator is not defined"，
  // 但会和 hasOwnProperty 矛盾：'webdriver' in nav 为真，却拿不到自身描述符。
  if (prop in t) return true;
  // 对"应该不存在"的检测属性，老实返回 false（如某些反爬探针属性）
  if (typeof prop === 'string' && /^(webdriver|__nightmare|_phantom|callPhantom)$/.test(prop)) return false;
  return true;  // 其余放行，让脚本继续，缺的由 get 记录
}
```

要点：`has` 返回 `true` 的属性，若脚本接着用 `Object.getOwnPropertyDescriptor` / `hasOwnProperty` 查，必须能给出**一致**的描述符（见 §4），否则"in 为真但没描述符"= 暴露。对真不该存在的（webdriver 探针）直接 `has` 返回 false 最干净。

---

## 4. 属性描述符 + getter vs value（指纹值要定义对位置）

真浏览器里 `navigator.userAgent` 是 **`Navigator.prototype` 上的 accessor（getter）**，`navigator` 自身没有这个 own 属性；多数内置属性 `enumerable:false, configurable:true`。

```javascript
// ✅ 正确：定义在原型上、用 getter、抄真实描述符
function defineNav(name, getter) {
  Object.defineProperty(Navigator.prototype, name, {
    get: asNative(getter, `get ${name}`),
    enumerable: false, configurable: true,        // 抄真浏览器
  });
}
defineNav('userAgent', function () { return UA; });
defineNav('platform',  function () { return 'Win32'; });
defineNav('webdriver', function () { return false; });

// ❌ 错误：navigator.userAgent = UA
//    → 成了 navigator 自身的 value 属性、enumerable:true
//    → Object.keys(navigator) 多出 userAgent、描述符是 {value,...} 而非 {get}
//    → 一比对真浏览器立刻露
```

**[需 V8 层] 强改不可配置位**：要把某属性改成 `configurable:false`（DONT_DELETE）等真实位、或在 `configurable:false` 上强行重定义/删除，纯 JS 做不到 → NodeSandbox/node-sandbox 的 `defineProperty(obj, key, {value, mode})`，`mode` 是位掩码：`READ_ONLY=1(writable false) | DONT_ENUM=2(enumerable false) | DONT_DELETE=4(configurable false)`，`mode=7` 三个都 false、`mode=0` 三个都 true。

---

## 5. toString / valueOf / Symbol.toPrimitive 强转

```javascript
// 让对象在 '' + obj / obj + 1 / `${obj}` 下表现得像真对象
Object.defineProperty(navigator, Symbol.toPrimitive, {
  value: asNative(function (hint) {
    if (hint === 'number') return NaN;
    return '[object Navigator]';     // 真浏览器 '' + navigator 即这个
  }, '[Symbol.toPrimitive]'),
  configurable: true, enumerable: false,
});
// Object.prototype.toString.call(navigator) → '[object Navigator]'
Object.defineProperty(navigator, Symbol.toStringTag, { value: 'Navigator', configurable: true });
```

Proxy 的 `get` 也要让 `Symbol.toPrimitive` / `Symbol.toStringTag` / `valueOf` / `toString` 命中真值，否则强转抛 `Cannot convert object to primitive value`。

---

## 6. `document.all` —— 纯 JS 硬天花板 **[需 V8 层]**

`document.all` 是 JS 史上唯一 `typeof === 'undefined'` 却又能用的对象（HTML 兼容遗产）。反爬 `typeof document.all === 'undefined'` 判真浏览器。

```javascript
// 纯 JS 做不到（typeof 无法被 Proxy 拦）。只能近似：
// document.all 本身存在、可索引，但 typeof 仍是 'object' → 会被精确检测识破。

// [需 V8 层] node-sandbox: new wanfeng.xtd  /  Utils.setUndetectable(obj)
//   → 引擎层把对象 type 标记为 undefined，typeof 真返回 'undefined'
```

遇到 `typeof document.all` 检测且必须过 → 直接上 NodeSandbox/node-sandbox 或换真浏览器，别在纯 JS 上耗。

---

## 7. error.stack 清理 —— 防 Proxy 路径泄漏 **[部分需 V8 层]**

反爬 `try{...}catch(e){ analyze(e.stack) }`，你的补环境文件路径/`Proxy` 帧出现在 stack 里就暴露。

```javascript
// 纯 JS：用 prepareStackTrace 过滤掉自己的帧
const _prep = Error.prepareStackTrace;
Error.prepareStackTrace = function (err, frames) {
  const clean = frames.filter(f => {
    const fn = f.getFileName() || '';
    return !/env-supplement|proxy-cookbook|node_modules[\\/]crawler-env/.test(fn);
  });
  return _prep ? _prep(err, clean) : clean.map(f => '    at ' + f).join('\n');
};
```

纯 JS 只能改 `prepareStackTrace`（V8 专有）；更隐蔽的 stack 探测（行号/格式指纹）要 **[需 V8 层]** NodeSandbox 的 `stack_intercept` / node-sandbox 的 `Utils.Error_get_stack` 在底层拦截。

---

## 8. iframe / contentWindow / createElement

```javascript
// createElement 按 tagName 返回带正确原型的元素壳
const _create = document.createElement.bind(document);
document.createElement = asNative(function createElement(tag) {
  const el = _create(tag);
  if (String(tag).toLowerCase() === 'iframe') {
    // contentWindow 不能直接 === window（反爬会比对），给一个自洽的子环境
    Object.defineProperty(el, 'contentWindow', {
      get: asNative(function () { return makeChildWindow(); }, 'get contentWindow'),
      configurable: true,
    });
  }
  if (String(tag).toLowerCase() === 'canvas') {
    el.getContext = asNative(function getContext(type) { return makeFakeCtx(type); }, 'getContext');
  }
  return el;
}, 'createElement');
```

注意：反爬常用 iframe 取**原始未污染的函数**反查你改没改原型。子 window 要带你已补好的同一套环境，否则 `iframe.contentWindow.Function.prototype.toString` 拿到原始版直接拆穿你 §2 的壳。

---

## 9. canvas / WebGL / 时序 指纹自洽

```javascript
// canvas：不能随机！用真实采集值（cdp-browser 在真 Chrome 抓 toDataURL 结果）
const REAL_CANVAS = '<从真 Chrome 抓到的 dataURL>';
function makeFakeCtx(type) {
  if (type === '2d') return { /* fillText/measureText... */ toDataURL: () => REAL_CANVAS };
  // WebGL：渲染结果 + WEBGL_debug_renderer_info(显卡名) 要和 UA 自洽
  return { getParameter(p) { /* UNMASKED_RENDERER_WEBGL → 'ANGLE (NVIDIA ...)' */ } };
}
// 时序：单调递增、数量级像浏览器（不是 Node 的 0.x ms 高精度）
let _t0 = Date.now();
performance.now = asNative(function now() { return Date.now() - _t0 + Math.random(); }, 'now');
```

测试态可固定（qxVm `isTest` / sdenv 固定随机数）方便 diff；生产态给可信递增值。**指纹整组自洽**：UA↔platform↔显卡名↔时区↔分辨率，错一个全废。用 lasawang 框架的 JSON profile 一把控全套最省心。

---

## 10. 自动补全循环脚手架（把 §1 串成可收敛流程）

```javascript
// loop.js —— 反复跑、报缺、人工/AI 补 env.js、再跑，直到 missing 不再新增
const { execSync } = require('child_process');
let prev = -1;
for (let round = 1; round <= 20; round++) {
  let out = '';
  try { out = execSync('node -r ./env.js run-and-collect.js', { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const miss = [...out.matchAll(/MISSING[\s\S]*?===\n([\s\S]*)/g)].map(m => m[1]).join('\n');
  const refErr = [...out.matchAll(/(\w[\w.]*) is not defined/g)].map(m => m[1]);
  const n = new Set([...miss.split('\n').filter(Boolean), ...refErr]).size;
  console.log(`round ${round}: missing=${n}`, refErr.length ? `| ReferenceError: ${refErr}` : '');
  if (n === 0) { console.log('✅ 收敛，去和真浏览器 diff 校验'); break; }
  if (n === prev) { console.log('⚠️ 不再收敛——可能撞天花板(canvas/document.all/stack)，考虑换真浏览器'); break; }
  prev = n;
  console.log('→ 把上面缺的补进 env.js（值优先 cdp-browser 抓真值），回车继续...');
  // AI 在这里读 refErr/miss，生成新的 env.js 补丁
}
```

收敛后**必须**做第 11 步校验，否则只是"跑通"不是"过检测"。

---

## 11. 与真浏览器 diff 校验（收敛判据）

```javascript
// 同一输入，分别在 Node 补环境 与 真 Chrome(cdp-browser) 跑目标函数，对比输出
// 一致           → 收敛成功
// 不一致         → 缺口在指纹自洽/时序/canvas，不是缺 API；按 §9 修或走逃生路线
// 反复对不上     → 撞天花板，换 cdp-browser / jsrpc-universal
```

---

## 速查：检测点 → 解法 → 是否需 V8 层

| 检测点 | 纯 JS 解法 | 需 V8 层? |
|---|---|---|
| `fn.toString()` = `[native code]` | 改写 `Function.prototype.toString` | 是（彻底）|
| `'x' in window` / `with` 漏出 | `has` 返回 true（探针属性返 false） | 否 |
| 描述符 getter vs value / enumerable | 原型上 `defineProperty` + getter | 否 |
| 改 `configurable:false` 位 | — | 是（`defineProperty(mode)`）|
| `'' + obj` 强转 | `Symbol.toPrimitive` / `toStringTag` | 否 |
| `typeof document.all === 'undefined'` | — | 是（`setUndetectable`/`xtd`）|
| `error.stack` 泄漏路径 | `Error.prepareStackTrace` 过滤 | 部分 |
| `iframe.contentWindow` 反查 | 给自洽子 window | 否 |
| canvas/WebGL 指纹 | 真实采集值（不能随机） | 否 |
| `navigator.webdriver` | 原型 getter 返 false | 否 |
| 时序 `performance.now` | 单调递增桩 | 否 |
