---
name: jsrpc-universal
description: JsRpc "kill-all" (Remote Procedure Call / RPC) technique — expose the JS or native algorithm functions inside an already-loaded real page/App via WebSocket/HTTP RPC, so Python can remotely invoke the algorithm in its real environment, eliminating the need to extract code, mock the environment, or reimplement the algorithm in pure code. Covers browser targets (Tampermonkey/console injection of HlClient → regAction registration → /go /execjs invocation) and Android targets (Java/native methods hooked and registered via SekiroClient inside frida/Xposed). Two mainstream frameworks: jxhczhl/JsRpc (a.k.a. "Heilianguai", a Go WebSocket server + JsEnv_Dev.js browser client, the de facto standard) and yint-tech/sekiro-open (production-grade distributed RPC, supporting web/Android/frida/Xposed, group+clientId routing, load balancing, cross-language). Also provides a decision guide: when to use JsRpc vs pure-algo vs node environment mocking. Trigger keywords: jsrpc, kill-all, rpc remote invocation, HlClient, regAction, JsEnv_Dev, execjs, Heilianguai, sekiro, SekiroClient, registerAction, registerSekiroHandler, remote invocation without extracting code, turn the browser into an RPC client, frida rpc, expose the algorithm, group clientId, ws://127.0.0.1:12080.
languages: [zh, en]
---

# JsRpc Kill-All (RPC Remote Invocation) Skill

> **Core idea**: Instead of reimplementing the algorithm, treat the "already-running real environment" (browser / App) as an algorithm server.
> Inject an RPC client into the page/process and register the target encryption function with `regAction("sign", fn)`;
> Python invokes it via a local HTTP endpoint → the server forwards it over WebSocket to the client → the client runs the real function in the **real environment** → and the result is sent back.
>
> In one sentence: **let the real environment do the computation for you — no code extraction, no environment mocking, no fingerprint forgery.**

Scope: authorized security research / CTF / education only.

---

## When to trigger (when to use JsRpc)

In the following scenarios, prefer JsRpc over grinding through pure-algo reimplementation or node environment mocking:

- The encryption algorithm is **too complex or drifts frequently** (vmp, ob obfuscation, control-flow flattening, weekly updates), making pure-algo too costly to build/maintain.
- The algorithm is **heavily dependent on the runtime environment**: it relies on `window`/DOM/`canvas`/WebGL fingerprints, on some already-initialized native context inside the App, or on login state/device binding that is hard to forge by mocking.
- What you need is **a logged-in session with real cookies/TLS fingerprint** (e.g. BOSS Zhipin's `__zp_stoken__`, the Ruishu URL suffix); letting a real browser send the request directly is the simplest approach.
- QPS is **low to medium** (single digits to a few dozen per second), where one or a few clients suffice; you are not after extreme throughput.
- You want to **ship quickly**: first get the business flow working over RPC to obtain data, then leave pure-algo reimplementation as a later optimization.

**Trigger keywords**: `jsrpc` / `kill-all` / `HlClient` / `regAction` / `JsEnv_Dev` / `execjs` / `Heilianguai` / `sekiro` / `SekiroClient` / `registerAction` / `registerSekiroHandler` / `expose the algorithm` / `turn the browser into an RPC client`.

Reference: this project author's `warterbili/BossZhipin_reverse` (mitm + injected RPC poller, turning a logged-in browser into an RPC client) and `warterbili/ruishu-re` (Ruishu URL suffix handled via JsRpc kill-all) are exactly real-world examples of this pattern.

---

## Choosing between the two frameworks

| | **jxhczhl/JsRpc** (Heilianguai) | **yint-tech/sekiro-open** |
|---|---|---|
| Positioning | De facto standard in the RE community, lightweight, quick to pick up | Production-grade distributed RPC, commercially extensible |
| Server | A single Go binary (main.go), download the release directly | Java (Maven build, `bin/sekiro.sh`), ships with a central service + docs site |
| Browser client | `JsEnv_Dev.js` → `new HlClient(wsURL)` | `new SekiroClient(wsURL)` |
| Browser API | `regAction(name, fn)` | `registerAction(name, fn)` |
| Android | None (browser/WeChat only) | ✅ Java/Xposed `registerSekiroHandler`, frida (Socket API, not WebSocket) |
| Routing | `group` + optional `clientId` + `fuzzy` | `group` + `clientId` |
| HTTP invocation | `/go?group=&action=&param=`, `/execjs` | `/business/invoke?group=&action=&param=` |
| Cross-language/cluster/auth | None | ✅ Load balancing, auth, multi-language clients |

**Rule of thumb**: single-machine browser RE, want it running in 5 minutes → JsRpc; need Android, multiple nodes, long-term production, load balancing → Sekiro.

---

## Workflow A: Browser target (JsRpc / Heilianguai)

Beginners most often stumble on "injection timing" and "JSON-encoding the parameters". Go in order:

1. **Start the server**: download the binary for your platform from the release and run it directly (listens on `0.0.0.0:12080` by default). Optionally edit `config.yaml`: `DefaultTimeOut` (how many seconds to wait when the executor returns nothing, default 30), `HttpsServices` (enable wss), `Cors`. `GET /list` shows which clients are currently connected.

2. **Inject the communication environment**: copy the entire `resouces/JsEnv_Dev.js`, paste it into the target site's browser **console** (or inject it at `document-start` via a Tampermonkey script, which is the most stable). ⚠️ **Must be injected while there are no breakpoints and the page is running normally** — do not inject while paused at a breakpoint, or the context will be invalid.

3. **Connect + register the algorithm function**:
   ```js
   var demo = new HlClient("ws://127.0.0.1:12080/ws?group=zzz");
   // Wrap and register the page's "real" encryption function:
   demo.regAction("sign", function (resolve, param) {
       // param has already been JSON.parse-attempted by the framework; just call the real function here
       var r = window.getSign(param.data, param.ts);  // ← the site's real algorithm
       resolve(r);                                      // ← the value passed to resolve is what is returned to Python
   });
   ```
   - `regAction(name, fn)`: `fn(resolve, param)`. With **no parameters** there is only `resolve`; **with parameters** the second argument is `param`.
   - When you can't find the entry to the real function, first probe with `/execjs` (see below), or manually get `window.getSign(...)` working in the console before registering.

4. **Invoke from Python** (`requests` is enough):
   ```python
   import requests, json
   # Single parameter
   r = requests.get("http://127.0.0.1:12080/go",
                    params={"group":"zzz","action":"sign","param":"hello"})
   # Multiple parameters: pass param as a JSON string; on the js side param will be an object
   r = requests.post("http://127.0.0.1:12080/go", data={
       "group":"zzz","action":"sign",
       "param": json.dumps({"data":"abc","ts":1718600000})})
   print(r.text)
   ```

5. **When you don't know the function name, probe with `/execjs`**: throw a snippet of JS directly into the real environment to run:
   ```python
   requests.post("http://127.0.0.1:12080/execjs",
       data={"group":"zzz","code":"(function(){return window.getSign('abc',1)})()"})
   ```
   There are also `GET /page/cookie?group=zzz` and `/page/html?group=zzz` to grab the current page's cookies/html directly.

6. **Multi-client routing**: when multiple clients are registered under the same `group`, an invocation is sent to one **random** client in that group by default. Use `clientId` to target a specific client; add `fuzzy=true` (or `1`) for **fuzzy matching** (a client matches if its clientId contains the passed value, and when several match, healthy clients are preferred):
   ```
   /go?group=zzz&clientId=hliang&fuzzy=true&action=sign&param=abc
   ```

---

## Workflow B: Android target (Sekiro + frida / Xposed)

JsRpc does not support Android; Android goes through Sekiro (or Sekiro's frida socket SDK).

1. **Start the Sekiro central service**: `build_demo_server.sh` → run `bin/sekiro.sh`/`.bat`, which ships with a docs site at `http://127.0.0.1:5612/sekiro-doc`.

2. **Register inside frida** (recommended, no APK modification needed). Sekiro's frida SDK uses the **standard Frida Socket interface** (not WebSocket, and with built-in UTF-8 encoding because Frida doesn't support it), and can work without a USB relay:
   ```js
   // In the frida script: first hook the target Java/native method, then register it out
   var client = new SekiroClient({ sekiroGroup: "test_frida", clientId: "dev1" });
   client.registerAction("encrypt", function (request, resolve, reject) {
       Java.perform(function () {
           var C = Java.use("com.target.Crypto");
           resolve(C.encrypt(request.param));  // call the real method in the real App context
       });
   });
   ```

3. **Register inside Xposed/Java** (requires an Xposed module):
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

4. **Invoke from Python/HTTP** (identical to the web side, just a different path):
   ```python
   requests.get("http://127.0.0.1:5612/business/invoke",
       params={"group":"test_frida","action":"encrypt","param":"abc"})
   ```

5. **Sekiro's browser side** also uses the same framework (`new SekiroClient("wss://.../business/register?group=&clientId=")` + `registerAction`); the only difference from the frida side is that the browser uses WebSocket while frida uses Socket.

---

## When **not** to use JsRpc (decision comparison)

| Approach | When to choose it | Cost |
|---|---|---|
| **JsRpc / Sekiro** | The algorithm is too hard / drifts fast, depends heavily on the runtime environment or login state, low-to-medium QPS, need to ship fast | Must **keep a real browser/real App running long-term** (resources, stability); throughput is limited by a single client; concurrency relies on queuing/multiple clientIds |
| **Pure-algo** | The algorithm is readable, relatively stable, you need **high concurrency / headless deployment**, and you want to be fully independent of the client | High reimplementation + long-term maintenance cost; breaks whenever the site changes (e.g. Ruishu changing the type=2 value) |
| **node environment mocking (node-bridge)** | The algorithm logic can be extracted but it **only lacks `window`/`document` and similar environment**, you want medium concurrency running server-side and don't want a persistent browser | Mocking the environment is a lot of work, easy to miss detection points, and detection-point updates require patching |

**Recommended path**: first use JsRpc to **get the flow working and pull data** (validate feasibility, sample real inputs/outputs), then decide whether to upgrade to pure-algo or environment mocking based on your concurrency/deployment needs. The real samples collected via RPC are themselves the reference data for pure-algo reimplementation.

For detailed concurrency/queuing/keep-alive and troubleshooting, see [`references/routing-concurrency.md`](references/routing-concurrency.md); for Tampermonkey persistent injection and mitm injection patterns, see [`references/injection-patterns.md`](references/injection-patterns.md).

---

## Gotchas (real-world pitfalls)

- **Injection timing**: injecting `JsEnv_Dev.js` while paused at a breakpoint yields an invalid context. Either inject while the page is running normally, or use Tampermonkey with `@run-at document-start`.
- **Double JSON handling of param**: the JsRpc server delivers `param` as-is, and the js client **will attempt `JSON.parse(param)`**. For multiple parameters you must `json.dumps` to a string on the Python side so the js side gets an object; pass a plain string and the js side gets a string.
- **resolve must be called**: if a `regAction` fn goes async (Promise/callback) and forgets to call `resolve`, the HTTP side will hang until `DefaultTimeOut` (default 30s) times out. For async functions, `return` the Promise or `resolve` inside `.then`.
- **Root causes of timeouts**: `/go` returning a "timeout" is usually because ① the `action` function name is wrong (the client can't find the action), ② an exception inside the real function went uncaught, or ③ the client's ws has disconnected. First `GET /list` to confirm the client is online and the action has been reported.
- **Disconnect and reconnect**: `HlClient` automatically reconnects 10s after `onclose`/`error`, and on `regAction` it re-reports the method list via `_reportActions` — a page refresh/navigation disconnects it, so you must re-inject after a refresh.
- **Concurrency is pseudo-concurrency**: a single browser client is single-threaded; multiple HTTP requests hitting the same client **queue up and run serially**. To raise throughput, register multiple clientIds under the same group (multiple tabs / multiple browsers / multiple devices) so the server randomly distributes the load.
- **Public exposure risk**: `config.yaml` defaults to `0.0.0.0:12080`, which exposes it to the LAN/public internet. For authorized research, always change it to `127.0.0.1` or add protection, otherwise anyone can call your algorithm endpoint.
- **Sekiro frida is not WebSocket**: the frida side uses the Socket API with built-in UTF-8 encoding (Frida doesn't natively support utf8); don't copy the browser's WebSocket code verbatim.
- **Login state / session routing**: when you reuse a "logged-in browser" via RPC (the BossZhipin_reverse pattern), isolate different accounts with different group/clientId, otherwise requests will be randomly sent to the wrong account's session.

---

## Example: get a sign working in 30 seconds

```bash
# 1. Server (after downloading the release)
./JsRpc            # listens on 0.0.0.0:12080
```
```js
// 2. Target site console: after pasting the entire JsEnv_Dev.js
var c = new HlClient("ws://127.0.0.1:12080/ws?group=demo&clientId=tab1");
c.regAction("sign", (resolve, param) => resolve(window.getSign(param)));
```
```python
# 3. Python
import requests
print(requests.get("http://127.0.0.1:12080/go",
      params={"group":"demo","action":"sign","param":"payload123"}).text)
# → the sign computed by the real browser
```
