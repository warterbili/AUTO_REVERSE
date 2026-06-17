# Web Akamai sensor_data 方法论

> 诚实前置：**Web 端没有通用生成器。** Akamai 采集脚本逐站点定制、频繁换版、canvas 不可伪造、强依赖真实行为，再叠加 TLS 指纹 + IP 信誉。这是 px-reverse 式的**逐目标硬活**。
> 本文给的是方法论 + 优先级，不是"复制粘贴就过"的代码。基于 xiaoweigege/akamai2.0-sensor_data 对 maersk.com 的分析 + Akamai _abck 公开握手文档。

## 0. 优先级：先问"要不要纯算法逆向"

按成本从低到高，先用前面的能解决就别往后走：

1. **真实浏览器自动化**（`cdp-browser`）—— 真实 Chrome 无 webdriver 特征 + 真实指纹 + 真实行为 + 住宅 IP。Akamai 对真实浏览器极宽容。**80% 的 Web 场景到这一步就够了。**
2. **浏览器跑 sensor + 导出 cookie 给后端**（半自动）—— 浏览器只负责过 Akamai 拿 `~0~` 态 `_abck`，业务请求交给后端高并发。
3. **node_bridge 跑混淆脚本**（`node-bridge-build`）—— 把采集脚本在 node + 补环境里跑出真实 sensor_data，不还原算法。比纯 AST 还原省事。
4. **纯算法 AST 还原** —— 最贵。混淆脚本 AST 反混淆 → 还原 58 元素数组各字段 → 真实 canvas 池 + 行为模拟。只有需要极高并发/无浏览器环境时才值得。

## 1. cookie 角色

| cookie | 角色 | 何时出现 |
|---|---|---|
| `_abck` | 核心校验态，sensor_data 的返回物 | 首屏下发，sensor POST 后更新 |
| `bm_sz` | Bot Manager session，sensor 生成的输入之一 | 首屏边缘下发 |
| `ak_bmsc` | 边缘会话态 | 首屏 |
| `bm_sv`/`bm_mi`/`bm_lso` | 辅助会话 | 视站点 |
| `sbsd`/`sbsd_o` | 较新的二级增强校验 | Akamai v3+ 站点 |

## 2. _abck 状态机（详）

```
GET 首页 → Set-Cookie: _abck=<token>~-1~-1~...      ← 无效态
POST sensor_data（带最新 _abck + bm_sz）
  ├─ _abck 含 ~0~        → 有效，停，请求业务接口
  ├─ _abck 末尾 ~-1~-1   → 继续 POST
  └─ 站点不用 ~0~ 指示器 → 固定 POST 3 次后视为就绪
业务接口 403 + 重新下发 ~-1~-1 → 该 _abck 被作废，重新握手（通常 1 次 sensor 即可恢复）
```

实现要点：
- 用持久 session（curl_cffi `Session` + impersonate）保 cookie 自动回写。
- 每次 POST 前确认带的是**最新**的 `_abck`/`bm_sz`。
- 监控响应延迟：sensor 不够真实时 Akamai "放行但拖慢"（10s 量级），状态码 200 不代表 trust 高。

## 3. sensor_data 结构（来自 maersk.com 分析）

- 由一个 **58 元素数组**拼接后加密生成。
- 最关键两项：**canvas 指纹** + **鼠标运动轨迹**。
- **canvas 指纹不能随机伪造** → 收集真实浏览器的 canvas 值替换。
- 运动轨迹 → 算法模拟真实鼠标移动/点击。
- `akamai-bm-telemetry`（请求头）= sensor_data 的 base64 变体，生成方式简单（对 sensor_data 做 base64）。

## 4. AST 还原路线（最贵那条，仅在必要时）

1. CDP 抓 sensor POST + 下载混淆采集脚本，**记 sha256 并 pin 版本**。
2. AST 反混淆（acorn / babel）—— 把混淆脚本还原成可读 JS（参考 ruishu-reverse 的 AST 方法论：构建函数映射表 + 递归追调用链）。
3. 定位 58 元素数组装配点，逐字段标注：固定/canvas/轨迹/时间/随机。
4. 数据驱动：同版本采多批真实 sensor，逐字段比对找每段来源（不要硬读内层 VM）。
5. 真实 canvas 池 + 行为模拟接上，过握手状态机。

## 5. sbsd 二级握手（新站点）

- Akamai 升级 v3 后引入 `sbsd`/`sbsd_o`，是独立于 sensor_data 的增强校验类型。
- 先确认目标业务接口**是否真的要求** sbsd（很多站点没启用）。
- 启用则需单独逆其载荷 —— 参考 xiaoweigege/akamai2.0-sensor_data 的 sbsd 支持说明。把它当成第二个 sensor 类型对待，不要混进 sensor_data 的逻辑。

## 6. 诚实的难度评估

| 因素 | 现实 |
|---|---|
| 脚本通用性 | ❌ 逐站点定制，无通用 |
| 版本稳定性 | ❌ 频繁换版，老还原失效 |
| canvas | ❌ 不可伪造，须真实池 |
| 行为 | 须真实/拟真轨迹 |
| TLS | 必须 curl_cffi/tls-client/浏览器 |
| IP | 住宅 IP，换 IP |
| 结论 | **优先浏览器自动化；纯算法逆向是逐目标长期投入** |

## 7. 配合的 skill

- `cdp-browser`：抓 sensor POST + 浏览器自动化（首选）
- `node-bridge-build`：node 补环境跑混淆脚本出 sensor（次选）
- `web-api-analyzer`：定位 sensor 提交端点与业务接口
