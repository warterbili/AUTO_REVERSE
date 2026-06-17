---
name: akamai-reverse
description: Akamai Bot Manager (BMP / Bot Manager Premier) 逆向工程 skill —— 从抓包指纹识别到生成被服务端接受的 sensor_data / akamai-bm-telemetry，拿到合法 _abck cookie 的端到端方法论。覆盖 _abck / bm_sz / ak_bmsc / sbsd 四类 cookie 的角色、sensor_data POST 握手（请求 N 次、`-1-` 无效态 vs `~0~` 有效态判定）、Web sensor_data 与 移动端 BMP（pipe -1,2,-94 协议 + RSA/AES/HMAC + PoW）两条分叉路线、sensor 字段结构（-100 系统信息 / -115 校验统计 / -117 触摸 / -143 motion 等）与 generator 参数化（app 包名 / lang / version / device 指纹）、以及 Akamai 脚本版本漂移（pin script version、sensor 格式跨版本变化）的现实。移动端直接路由到 xvertile/akamai-bmp-generator 作为可用起点；Web 端给方法论（须逐目标干活）。Trigger terms: Akamai, Akamai Bot Manager, BMP, sensor_data, akamai-bm-telemetry, _abck, bm_sz, ak_bmsc, sbsd, bm-verify, x-acf-sensor-data, /_bm/, akam, "bypass akamai", "akamai 反爬", "_abck 无效".
languages: [zh, en]
---

# Akamai Bot Manager 逆向工程 Skill

> **TL;DR**：Akamai 反爬有两层 —— (1) HTTPS 传输层 TLS/JA3/JA4 + HTTP2 指纹；(2) 应用层行为风控 = 客户端采集设备/浏览器/行为信号 → 加密成 **sensor_data** POST 给 Akamai 边缘 → 换回一个合法 **_abck** cookie。
> 本 skill 给的是**采集 + 路由 + 方法论**：先指纹判型，移动端直接路由到现成的全量逆向实现 `xvertile/akamai-bmp-generator`；Web 端给 px-reverse 式的逐目标方法论。
>
> 诚实说在前面：**Akamai Web sensor_data 没有一份"通用生成器"**。脚本逐站点/逐版本变化，canvas 指纹不能随机伪造，行为轨迹要足够真实，还叠加 TLS 指纹 + IP 信誉。**这是逐目标的活。** 移动端 BMP 因为协议相对稳定、设备指纹可池化，才有现成全量实现。

---

## When to trigger（指纹识别）

命中以下任一即为 Akamai Bot Manager，用本 skill：

**Cookie 指纹**（最可靠）：
- `_abck` —— 核心校验 cookie，sensor_data POST 的返回物。形如 `<token>~-1~-1~...` 或 `...~0~...`
- `bm_sz` —— Bot Manager session，首屏由 Akamai 边缘下发，sensor 生成时作为输入参数之一
- `ak_bmsc` —— Akamai Bot Manager session cookie（边缘侧会话态）
- `bm_sv` / `bm_mi` / `bm_lso` —— 辅助会话 cookie
- `sbsd` / `sbsd_o` —— **较新**的 Akamai 增强校验类型（Akamai 升级 v3 后引入，xiaoweigege 仓库已支持），独立于 sensor_data 的二级握手

**请求指纹**：
- POST body 是一坨 base64 大块 + `$` 分隔（Web）或 pipe 协议 `-1,2,-94,...`（移动端 BMP）
- 请求头 / body 出现 `akamai-bm-telemetry`、`x-acf-sensor-data`、`X-Akamai-BMP`
- 采集脚本 URL 含混淆路径，常见 `/_bm/`、`...akam...`、随机化的脚本名（每站点不同）
- 被拦截时返回 **403**（不是 412/429），且响应里重新 `Set-Cookie: _abck=...~-1~-1~...`

**判型时的反例**（不要用本 skill）：`_px3/_px2`→PerimeterX（用 px-reverse）；`datadome` cookie→DataDome；`__cf_bm/cf_clearance`→Cloudflare；`X-Castle-Request-Token`→Castle（用 castle-reverse）。

---

## ⚠️ 第一步永远是分叉：Web sensor_data vs 移动端 BMP

这是新手最容易做错的地方 —— **两条路线协议完全不同，工具完全不同**：

| 维度 | **Web sensor_data** | **移动端 BMP（Bot Manager Premier mobile SDK）** |
|---|---|---|
| 客户端 | 浏览器 JS（混淆采集脚本） | Android/iOS App 内嵌 Akamai BMP SDK |
| 载荷名 | `sensor_data` / `akamai-bm-telemetry`（header，base64） | `sensor_data`（pipe 协议串） |
| 关键信号 | **canvas 指纹**、WebGL、字体、navigator、**鼠标轨迹** | **设备 Build 信息**、传感器 motion（加速度/陀螺仪/方向）、触摸事件 |
| 加密 | 逐版本自定义（AST 还原脚本） | RSA(公钥) 包 AES key + AES-CBC + HMAC-SHA256 + base64 + 可选 **PoW** |
| 现成实现 | ❌ 无通用，逐目标干活 | ✅ **`xvertile/akamai-bmp-generator`**（Go，全量逆向 2.1.2→4.2.1） |
| 难点 | canvas 不能随机伪造 + 行为真实度 + TLS 指纹 | 设备指纹池质量 + pin 对版本 |

**路由规则**：
- **目标是移动端 App / 移动端 API** → 直奔 `references/bmp-mobile.md`，用 `akamai-bmp-generator` 作为起点。这是本 skill 唯一"开箱即用"的路径。
- **目标是网站** → 走 `references/web-sensor.md` 的方法论。先用 `cdp-browser` 真实 Chrome 抓 sensor POST，确认能不能直接用浏览器自动化绕过（很多时候这比纯算法划算）。

---

## Workflow（编号步骤 —— 不要跳步）

1. **指纹判型**：先确认确实是 Akamai（见上 When to trigger）。`GET` 目标首页，看响应有没有 `bm_sz` / `ak_bmsc` 的 `Set-Cookie` 和 `_abck`。被业务接口 403 时抓响应里的 `Set-Cookie: _abck=` —— 末尾是 `~-1~-1` 就是无效态，确认是 sensor 风控而非纯 IP 封禁。

2. **分叉**：移动端 → 步骤 3（BMP）；Web → 步骤 6（sensor_data）。**不要在没分型前就开始读脚本。**

3. **【移动端】先解决 TLS 指纹**：Akamai 第一层就查 TLS/HTTP2 指纹。Python 用 `curl_cffi`（impersonate chrome/safari/okhttp），Go 用 `bogdanfinn/tls-client`。**TLS 不对，sensor 再完美也 403。** 这一步独立于 sensor，先单独验证（带浏览器 UA + 正确 TLS GET 首页能拿到 `bm_sz` 即过关）。

4. **【移动端】跑 akamai-bmp-generator**：`git clone xvertile/akamai-bmp-generator && cd cmd/akamai-bmp-server && go run main.go`，POST `/akamai/bmp`：
   ```json
   {"app":"com.target.app","lang":"en_US","version":"3.3.4","challenge":false,"powUrl":"https://m.target.com"}
   ```
   返回 `{"sensor":"...","userAgent":...}`。**关键是 `version` 要 pin 到目标 App 真实使用的 BMP 版本**（见步骤 5）。

5. **【移动端】pin 对 BMP 版本**：用 jadx 反编译 App，搜 `BMPSDK` / `Akamai BMPSDK/` UA 字符串，或 frida hook sensor 生成点抓真实 sensor 头几个字段（pipe 串第一段就是版本号，如 `3.3.4`）。版本不对 → sensor 字段集 / 序号 / 协议头不匹配 → 403。generator 支持 2.1.2 / 2.2.2 / 2.2.3 / 3.1.0 / 3.2.3 / 3.3.0 / 3.3.1 / 3.3.4 / 3.3.9 / 4.0.2 / 4.2.1。

6. **【Web】先试浏览器自动化**：用 `cdp-browser`（真实 Chrome，无 webdriver 特征）+ 残留指纹 + 住宅 IP 直接访问。Akamai 对真实 Chrome + 真实行为非常宽容。**能用浏览器解决就别纯算法逆向 sensor_data**（成本差一个数量级）。

7. **【Web】抓 sensor POST + pin 脚本**：CDP 拦截 sensor_data POST（找发往 Akamai 边缘的那个 POST，body 是 base64 大块）。同时下载混淆采集脚本并记 sha256 —— **Akamai 频繁换脚本版本，必须 pin 住同一版本采集多批样本**，否则字段对不齐。

8. **【Web】sensor_data 握手循环（abck 状态机）**：见下面 §_abck 握手。

9. **【Web】sbsd（如有）**：较新站点除 sensor_data 外还要过 sbsd 二级握手。先确认 sbsd cookie 是否存在/是否被业务接口要求；存在则需单独逆向其载荷（参考 xiaoweigege/akamai2.0-sensor_data 的 sbsd 支持）。

10. **稳定性测试**：拿到 `~0~` 态 `_abck` 后请求业务接口；连续 5+ 次、换 IP、间隔请求都 200 才算过。

---

## 🔑 _abck 握手状态机（核心、最容易写错）

sensor_data **不是发一次就完事**，是一个状态机：

```
初始 GET 首页 → Akamai 下发 _abck=<token>~-1~-1~...   ← 无效态（末尾 ~-1~-1）
   │
   ▼ POST sensor_data #1（带当前 _abck + bm_sz）
更新的 _abck 仍可能是 ~-1~-1（trust 不够）
   │
   ▼ POST sensor_data #2、#3 …
_abck 变成 ...~0~...   ← 有效态！可以停了
```

**判定规则**（来自 hypersolutions / xiaoweigege 实战）：
- `_abck` 含 `~0~` → **有效，停止 POST**，可以请求业务接口。
- `_abck` 末尾 `~-1~-1` → 仍无效，继续 POST（或参数不够真实，被永久压在无效态）。
- 站点**不用 `~0~` 指示器**时：经验值是**固定 POST 3 次** sensor 后即视为就绪。
- 每次 POST 必须带上**当前最新的 `_abck` + `bm_sz`**（cookie 会随响应更新，要回写）。
- `_abck` 有时效，业务接口 403 重新下发 `~-1~-1` 时要重新走握手（通常 1 次 sensor 即可从"被作废态"恢复）。

> ⚠️ 易错点：很多人 sensor 字段全对了却拿不到 `~0~`。原因往往是 **(a) 没回写更新后的 `_abck`/`bm_sz` 就发下一次**；**(b) POST 次数不够**；**(c) sensor 不够真实，被 Akamai "放行但拖慢"**（xiaoweigege 原文：参数不够真实 akamai 会给通过但拖慢请求 10s）；**(d) TLS/IP 层先挂了，跟 sensor 无关。**

---

## sensor 字段结构（高层）+ generator 参数化

**移动端 BMP**（pipe 协议，来自 akamai-bmp-generator 源码，以 3.3.4 为例）：

序列化格式：每个字段 `-1,2,-94,<id>,<value>` 拼接（`SerializeBmp`）。关键字段 id：

| id | 含义 | 来源 |
|---|---|---|
| (首段) | BMP 版本号，如 `3.3.4` | 常量，**必须 pin 对** |
| `-100` | 系统信息（屏幕、电量、Build.MODEL/BRAND/FINGERPRINT、androidId、lang…） | device 指纹 + `UrlEncode` |
| `-101` | event listeners `do_en,dm_en,t_en` | 常量 |
| `-103` | 后台事件 | 随机时间序列 |
| `-112` | 性能基准 `PERF_BENCH` | device 指纹池 |
| `-115` | **校验统计**（touchVel/motion 累加值/时长/`FeistelEncode` 校验和） | 计算，**这段最关键，错了直接挂** |
| `-117` | 触摸事件序列 | 随机生成 |
| `-143` | motion 数据（加速度计/陀螺仪，DCT 变换 + `BmpHash` 编码） | 随机生成 |
| `-150` | `1,0` | 常量 |

加密链（`EncryptSensor`）：`AES key(16B 随机) → RSA-PKCS1v15 公钥加密 → b64`，`sensor 串 → AES-128-CBC(随机IV) → iv+密文 → HMAC-SHA256 → 全部 b64`，最终 `<encrypted>$<powResponse>$<powToken>`。

**参数化入口**（generator 的 `AkamaiRequest`）：
- `app` —— App 包名（如 `com.ihg.apps.android`），进 `-100` 字段，**必须是目标真实包名**
- `lang` —— 如 `en_US`，进 `-100`
- `version` —— BMP 版本，**必须 pin 对目标**
- `challenge` + `powUrl` —— 是否做 Proof-of-Work（站点开了 PoW 才需要，会 GET `<domain>/_bm/get_params?type=sdk-pow` 拿 nonce/difficulty 并求解 SHA-256 PoW）
- device —— 从 `devices.json` 设备池随机取（2K 真实设备指纹）；**池子质量直接决定通过率**

**Web sensor_data** 结构高层：xiaoweigege 分析 maersk.com 为一个 **58 元素数组**拼接加密，其中 **canvas 指纹 + 鼠标运动轨迹最关键**，canvas 不能随机伪造（须收集真实浏览器的）。`akamai-bm-telemetry` header = sensor_data 的 base64 变体。**逐版本变化，靠 AST 还原混淆脚本**，没有现成通用实现。

---

## Gotchas（真实踩坑）

1. **TLS 指纹是第一道墙，独立于 sensor**。`requests`/`httpx` 裸发必 403。必须 `curl_cffi`(impersonate) / `tls-client`(Go) / 真实浏览器。先单独验证 TLS 过关再碰 sensor。
2. **`bm_sz` / `_abck` 要回写**。每次响应都可能更新这两个 cookie，下一次请求必须带最新的。用持久 session（curl_cffi Session / cookiejar）。
3. **BMP 版本 pin 错 = 字段集不匹配 = 403**。先 jadx/frida 确认目标 App 的真实 BMP 版本号再选 generator 的 `version`。
4. **设备指纹池质量决定一切**（移动端）。用现成 `devices.json` 可能很快被标记；高并发要扩充真实设备池 + 一机一指纹 + 换 IP。
5. **canvas 不能随机伪造**（Web）。必须收集真实浏览器 canvas 指纹替换；motion/鼠标轨迹要算法模拟得像真人。
6. **"放行但拖慢"陷阱**。sensor 不够真实时 Akamai 不直接 403，而是放行却把响应拖到 10s —— 看起来通过了其实置信度很低。监控响应延迟，别只看状态码。
7. **脚本版本漂移**（Web）。Akamai 频繁更新采集脚本，老的 AST 还原结果会失效。**pin sha256、同版本采多批样本**，把还原产物与版本号绑定。
8. **sbsd 是独立二级握手**。新站点过了 sensor_data 仍可能被 sbsd 卡。先确认 sbsd 是否被业务接口强制要求，再决定要不要单独逆它。
9. **IP 信誉是隐藏维度**。数据中心 IP 即使 sensor 完美也可能被压制；用住宅 IP 才能稳定拿 `~0~`。403 不一定是你 sensor 的错，先用 trust 矩阵（真实浏览器/你的脚本 × 干净/脏 IP）定位墙在哪。
10. **PoW 只在站点开启时才需要**（`challenge:true`）。盲目开 PoW 会多打一个 `/_bm/get_params` 请求、徒增暴露面；先确认目标是否真的要 PoW。
11. **`akamai-bmp-generator` 是起点不是终点**。它给的是协议正确的 sensor 骨架；具体站点的设备池、版本、PoW 开关、TLS、IP 仍要你按目标调。诚实对待"这是逐目标的活"。

---

## Example（移动端最短可用路径）

```bash
# 1. 起 generator
git clone https://github.com/xvertile/akamai-bmp-generator
cd akamai-bmp-generator/cmd/akamai-bmp-server && go run main.go    # :1337

# 2. 生成 sensor（version 必须 pin 对目标 App）
curl -s -XPOST localhost:1337/akamai/bmp -d \
  '{"app":"com.ihg.apps.android","lang":"en_US","version":"3.3.4","challenge":false}'
# → {"sensor":"...$...$","userAgent":"...","model":"SM-A326U",...}
```

```python
# 3. 用正确 TLS + abck 握手（Python 侧）
from curl_cffi import requests
s = requests.Session(impersonate="chrome")            # 关键：TLS 指纹
s.get("https://m.target.com/")                         # 拿 bm_sz / 初始 _abck

for i in range(3):                                     # abck 状态机
    sensor = gen_sensor()                              # 调 generator
    r = s.post("https://m.target.com/akam/...",        # sensor 提交端点
               data=sensor, headers={"User-Agent": UA})
    abck = s.cookies.get("_abck", "")
    if "~0~" in abck:                                  # 有效态，停
        break

# 4. 带合法 cookie 请求业务接口
print(s.get("https://m.target.com/api/...").status_code)   # 期望 200
```

> Web 端没有等价"最短路径"。请走 `references/web-sensor.md`：优先 `cdp-browser` 浏览器自动化；纯算法逆向是逐目标的硬活（AST 还原脚本 + 真实 canvas 池 + 行为模拟）。

---

## 配套引用

| 文件 | 内容 |
|---|---|
| [`references/bmp-mobile.md`](references/bmp-mobile.md) | 移动端 BMP 全量协议：pipe 字段表 + 加密链 + PoW + akamai-bmp-generator 用法 + 版本 pin 方法 |
| [`references/web-sensor.md`](references/web-sensor.md) | Web sensor_data 方法论：cookie 状态机细节 + 浏览器自动化优先策略 + AST 还原路线 + sbsd + 诚实的难度评估 |

相关 skill：移动端配合 `jadx-reverse-engineering`(pin 版本) + `frida-hooking`(抓真实 sensor)；Web 端配合 `cdp-browser`(抓包/自动化) + `node-bridge-build`(跑混淆脚本)。

---

## ❌ 不要踩的"自然语言陷阱"

1. **"找个 Akamai 通用过法"** —— Web 端不存在。逐站点/逐版本。
2. **"sensor 发一次就行"** —— 错，是状态机，看 `~0~` 或固定 3 次。
3. **"状态码 200 就过了"** —— 错，注意"放行但拖慢"，看延迟和业务数据是否真实。
4. **"requests 加个 UA 就行"** —— 错，TLS 指纹先挂。
5. **"随机生成 canvas"** —— 错，canvas 不能伪造，要真实采集。
6. **"403 一定是 sensor 错"** —— 未必，先用 trust 矩阵分清 sensor / TLS / IP 哪层挂了。

---

*本 skill 基于 xvertile/akamai-bmp-generator（移动端全量逆向，Go）+ xiaoweigege/akamai2.0-sensor_data（Web sensor_data/sbsd 分析）+ Akamai _abck 握手公开文档整理。所有协议字段、加密链、cookie 状态来自源码与实测，非记忆杜撰。*
