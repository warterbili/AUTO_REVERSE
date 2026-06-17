---
name: jsrpc-universal
description: JsRpc 通杀（远程过程调用 RPC）技术——把已加载的真实页面/App 里的 JS 或 native 算法函数通过 WebSocket/HTTP RPC 暴露出来，让 Python 远程调用真实环境里的算法，从而免去抠代码、补环境、纯算还原。覆盖浏览器目标（油猴/控制台注入 HlClient → regAction 注册 → /go /execjs 调用）与 Android 目标（frida/Xposed 内 SekiroClient 注册 hook 后的 Java/native 方法）。两套主流框架：jxhczhl/JsRpc（黑脸怪，Go ws 服务 + JsEnv_Dev.js 浏览器客户端，事实标准）与 yint-tech/sekiro-open（生产级分布式 RPC，支持 web/Android/frida/Xposed，group+clientId 路由、负载均衡、跨语言）。同时给出决策：何时用 JsRpc vs 纯算 vs node 补环境。触发词：jsrpc、通杀、rpc 远程调用、HlClient、regAction、JsEnv_Dev、execjs、黑脸怪、sekiro、SekiroClient、registerAction、registerSekiroHandler、远程调用免抠代码、浏览器变 RPC 客户端、frida rpc、把算法暴露出来、group clientId、ws://127.0.0.1:12080。
languages: [zh, en]
---

# JsRpc 通杀（RPC 远程调用）Skill

> **核心思想**：不还原算法，而是把"已经在运行的真实环境"（浏览器 / App）当成一台算法服务器。
> 在页面/进程里注入一个 RPC 客户端，把目标加密函数 `regAction("sign", fn)` 注册出去；
> Python 通过本地 HTTP 接口调用 → 服务端经 WebSocket 转发给客户端 → 客户端在**真实环境**里执行真函数 → 把结果回传。
>
> 一句话：**用真实环境替你算，免抠代码、免补环境、免造指纹。**

适用：授权范围内的安全研究 / CTF / 教学。

---

## When to trigger（何时用 JsRpc）

出现以下场景，优先考虑 JsRpc，而不是死磕纯算或 node 补环境：

- 加密算法**太复杂或经常漂移**（vmp、ob 混淆、控制流平坦化、每周更新），纯算成本/维护代价过高。
- 算法**强依赖运行时环境**：依赖 `window`/DOM/`canvas`/WebGL 指纹、依赖 App 内某个已初始化的 native 上下文、依赖登录态/设备绑定，补环境难以伪造。
- 需要的是**一个已登录、有真实 cookie/TLS 指纹的会话**（如 BOSS 直聘 `__zp_stoken__`、瑞数 URL 后缀），让真浏览器直接发请求最省事。
- QPS 是**低到中等**（每秒个位数到几十），单/少量客户端足够；不追求极致吞吐。
- 想**快速出活**：先用 RPC 把业务跑通拿数据，纯算还原作为后续优化。

**触发关键词**：`jsrpc` / `通杀` / `HlClient` / `regAction` / `JsEnv_Dev` / `execjs` / `黑脸怪` / `sekiro` / `SekiroClient` / `registerAction` / `registerSekiroHandler` / `把算法暴露出来` / `浏览器变 RPC 客户端`。

参考：本项目作者的 `warterbili/BossZhipin_reverse`（mitm + 注入 RPC poller，把已登录浏览器变 RPC 客户端）和 `warterbili/ruishu-re`（瑞数 URL 后缀走 JsRpc 通杀）正是此模式的实战范例。

---

## 两大框架选型

| | **jxhczhl/JsRpc**（黑脸怪） | **yint-tech/sekiro-open** |
|---|---|---|
| 定位 | 逆向圈事实标准、轻量、上手快 | 生产级分布式 RPC、可商用扩展 |
| 服务端 | 单个 Go 二进制（main.go），release 直接下载 | Java（Maven 构建，`bin/sekiro.sh`），自带中心服务 + 文档站 |
| 浏览器客户端 | `JsEnv_Dev.js` → `new HlClient(wsURL)` | `new SekiroClient(wsURL)` |
| 浏览器 API | `regAction(name, fn)` | `registerAction(name, fn)` |
| Android | 无（仅浏览器/微信） | ✅ Java/Xposed `registerSekiroHandler`、frida（Socket API，非 WebSocket） |
| 路由 | `group` + 可选 `clientId` + `fuzzy` | `group` + `clientId` |
| HTTP 调用 | `/go?group=&action=&param=`、`/execjs` | `/business/invoke?group=&action=&param=` |
| 跨语言/集群/鉴权 | 无 | ✅ 负载均衡、鉴权、多语言 client |

**经验法则**：单机浏览器逆向、想 5 分钟跑通 → JsRpc；需要 Android、多节点、长期生产、负载均衡 → Sekiro。

---

## Workflow A：浏览器目标（JsRpc 黑脸怪）

新手最容易在"注入时机"和"参数 JSON 化"上踩坑。按顺序来：

1. **起服务端**：从 release 下载对应平台二进制，直接运行（默认监听 `0.0.0.0:12080`）。可选改 `config.yaml`：`DefaultTimeOut`（执行端无返回时等待秒数，默认 30）、`HttpsServices`（启 wss）、`Cors`。`GET /list` 查看当前连了哪些客户端。

2. **注入通信环境**：复制 `resouces/JsEnv_Dev.js` 全文，粘贴到目标站点的浏览器 **控制台**（或用油猴脚本在 `document-start` 注入，最稳）。⚠️ **必须在没断点、页面正常运行时注入**——不要在断点暂停时注入，否则上下文异常。

3. **连接 + 注册算法函数**：
   ```js
   var demo = new HlClient("ws://127.0.0.1:12080/ws?group=zzz");
   // 把页面里"真实的"加密函数包一层注册出去：
   demo.regAction("sign", function (resolve, param) {
       // param 已被框架尝试 JSON.parse；这里直接调真函数
       var r = window.getSign(param.data, param.ts);  // ← 站点真实算法
       resolve(r);                                      // ← resolve 的值就是回给 Python 的
   });
   ```
   - `regAction(name, fn)`：`fn(resolve, param)`。**无参**时只有 `resolve`；**带参**时第二个是 `param`。
   - 找不到真函数入口时，先用 `/execjs` 探路（见下），或在控制台手动调通 `window.getSign(...)` 再注册。

4. **Python 调用**（`requests` 即可）：
   ```python
   import requests, json
   # 单参数
   r = requests.get("http://127.0.0.1:12080/go",
                    params={"group":"zzz","action":"sign","param":"hello"})
   # 多参数：param 传 JSON 字符串，js 端 param 会是 object
   r = requests.post("http://127.0.0.1:12080/go", data={
       "group":"zzz","action":"sign",
       "param": json.dumps({"data":"abc","ts":1718600000})})
   print(r.text)
   ```

5. **不知道函数名时用 `/execjs` 探路**：直接把一段 JS 丢进真实环境执行：
   ```python
   requests.post("http://127.0.0.1:12080/execjs",
       data={"group":"zzz","code":"(function(){return window.getSign('abc',1)})()"})
   ```
   也有 `GET /page/cookie?group=zzz`、`/page/html?group=zzz` 直接取当前页 cookie/html。

6. **多客户端路由**：同一 `group` 注册多个客户端时，调用默认**随机**发给该 group 中一个客户端。用 `clientId` 指定具体客户端；加 `fuzzy=true`（或 `1`）做**模糊匹配**（clientId 包含传入值即命中，多命中时优先健康客户端）：
   ```
   /go?group=zzz&clientId=hliang&fuzzy=true&action=sign&param=abc
   ```

---

## Workflow B：Android 目标（Sekiro + frida / Xposed）

JsRpc 不支持 Android；Android 走 Sekiro（或 Sekiro 的 frida socket SDK）。

1. **起 Sekiro 中心服务**：`build_demo_server.sh` → 跑 `bin/sekiro.sh`/`.bat`，自带文档站 `http://127.0.0.1:5612/sekiro-doc`。

2. **frida 内注册**（推荐，免改 APK）。Sekiro 的 frida SDK 用 **Frida 标准 Socket 接口**（不是 WebSocket，且自带 UTF-8 编码因为 Frida 不支持），可脱离 USB relay：
   ```js
   // frida 脚本里：先 hook 到目标 Java/native 方法，再注册出去
   var client = new SekiroClient({ sekiroGroup: "test_frida", clientId: "dev1" });
   client.registerAction("encrypt", function (request, resolve, reject) {
       Java.perform(function () {
           var C = Java.use("com.target.Crypto");
           resolve(C.encrypt(request.param));  // 在真实 App 上下文里调真方法
       });
   });
   ```

3. **Xposed/Java 内注册**（需要 Xposed 模块）：
   ```java
   new SekiroClient("test_xposed", UUID.randomUUID().toString())
       .setupSekiroRequestInitializer(new SekiroRequestInitializer() {
           @Override public void onSekiroRequest(SekiroRequest req, HandlerRegistry reg) {
               reg.registerSekiroHandler(new ActionHandler() {
                   @Override public String action() { return "encrypt"; }
                   @Override public void handleRequest(SekiroRequest r, SekiroResponse resp) {
                       resp.success(realEncrypt(r.getString("param")));
                   }
               });
           }
       }).start();
   ```

4. **Python/HTTP 调用**（与 web 端一致，只是路径不同）：
   ```python
   requests.get("http://127.0.0.1:5612/business/invoke",
       params={"group":"test_frida","action":"encrypt","param":"abc"})
   ```

5. **Sekiro 浏览器端**也用同一框架（`new SekiroClient("wss://.../business/register?group=&clientId=")` + `registerAction`），与 frida 端唯一区别是浏览器用 WebSocket、frida 用 Socket。

---

## 何时 **不** 用 JsRpc（决策对比）

| 方案 | 选它的条件 | 代价 |
|---|---|---|
| **JsRpc / Sekiro** | 算法太硬/漂移快、强依赖运行时环境或登录态、低中 QPS、要快速出活 | 必须**长期挂着真浏览器/真 App**（资源、稳定性）；吞吐受单客户端限制；并发要靠队列/多 clientId |
| **纯算（pure-algo）** | 算法可读、相对稳定、需要**高并发/无头部署**、要彻底脱离客户端 | 还原 + 长期维护成本高；站点改版即失效（如瑞数 type=2 改值） |
| **node 补环境（node-bridge）** | 算法逻辑能抠出来但**只缺少 `window`/`document` 等环境**、想中等并发跑在服务端、不想常驻浏览器 | 补环境工作量大、易漏检测点、检测点更新需补 |

**推荐路径**：先 JsRpc 把业务**跑通拿数据**（验证可行性、采样真实输入输出），再视并发/部署需求决定是否升级到纯算或补环境。RPC 采集到的真实样本本身就是纯算还原的对照数据。

详细的并发/队列/保活与排错见 [`references/routing-concurrency.md`](references/routing-concurrency.md)；油猴持久注入与 mitm 注入模式见 [`references/injection-patterns.md`](references/injection-patterns.md)。

---

## Gotchas（真实踩坑）

- **注入时机**：断点暂停时注入 `JsEnv_Dev.js` 会拿到异常上下文。要么在页面正常运行时注入，要么用油猴 `@run-at document-start`。
- **param 的 JSON 双重处理**：JsRpc 服务端把 `param` 原样下发，js 客户端**会尝试 `JSON.parse(param)`**。多参数必须 Python 端 `json.dumps` 成字符串传入，js 端才能拿到 object；传普通字符串则 js 端就是字符串。
- **resolve 必须被调用**：`regAction` 的 fn 如果走异步（Promise/回调）忘了调 `resolve`，HTTP 端会一直挂到 `DefaultTimeOut`（默认 30s）超时。异步函数请 `return` Promise 或在 `.then` 里 `resolve`。
- **超时根因**：`/go` 返回"超时"通常是①函数名 `action` 写错（客户端找不到 action）②真函数内部异常未捕获③客户端 ws 已断线。先 `GET /list` 确认客户端在线、action 已上报。
- **断线重连**：`HlClient` 自带 `onclose`/`error` 后 10s 重连，且 `regAction` 时会 `_reportActions` 重新上报方法列表——页面刷新/导航会断开，刷新后需重新注入。
- **并发是伪并发**：单个浏览器客户端是单线程，多个 HTTP 请求打到同一 client 会**排队串行**执行。要提吞吐就在同一 group 注册多个 clientId（多标签页/多浏览器/多设备）让服务端随机分流。
- **公网暴露风险**：`config.yaml` 默认 `0.0.0.0:12080`，会暴露到局域网/公网。授权研究务必改 `127.0.0.1` 或加防护，否则任何人可调你的算法接口。
- **Sekiro frida 不是 WebSocket**：frida 端走 Socket API 且自带 UTF-8 编码（Frida 原生不支持 utf8），别照抄浏览器的 WebSocket 写法。
- **登录态/会话路由**：当你靠 RPC 复用"已登录浏览器"（BossZhipin_reverse 模式），不同账号要用不同 group/clientId 隔离，否则请求会被随机发到错误账号的会话。

---

## Example：30 秒跑通一个 sign

```bash
# 1. 服务端（下载 release 后）
./JsRpc            # 监听 0.0.0.0:12080
```
```js
// 2. 目标站点控制台：粘贴 JsEnv_Dev.js 全文后
var c = new HlClient("ws://127.0.0.1:12080/ws?group=demo&clientId=tab1");
c.regAction("sign", (resolve, param) => resolve(window.getSign(param)));
```
```python
# 3. Python
import requests
print(requests.get("http://127.0.0.1:12080/go",
      params={"group":"demo","action":"sign","param":"payload123"}).text)
# → 真实浏览器算出来的 sign
```
