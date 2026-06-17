# 路由 / 并发 / 队列 / 保活 / 排错

JsRpc/Sekiro 的可靠性几乎全在这一层。RPC 本身是"一来一回"，难点是**多客户端怎么分流、并发怎么不互相踩、连接怎么保活、超时了怎么定位**。

## 1. group / clientId 路由模型

- **group**：逻辑命名空间，注入时必填（`?group=xxx`）。同一 group = 一组等价客户端。
- **clientId**：group 内区分具体客户端。不传时服务端自动生成（JsRpc 用服务端下发的 `registerId`，js 端记到全局 `rpc_client_id`，重连时自动带上）。
- **调用分流（JsRpc）**：调用接口只给 `group` → 服务端在该 group 的客户端里**随机**选一个。给了 `clientId` → 精确命中该客户端。加 `fuzzy=true|1` → **模糊匹配**：只要在线客户端的 clientId **包含**传入子串即命中；命中多个时**优先从健康客户端**里随机挑一个。
- **Sekiro**：同样 `group`+`clientId`，商用版支持显式负载均衡策略；开源版按 group 分发。

### 何时该用 clientId 隔离
- 复用"已登录会话"时，**每个账号一个 clientId**（甚至一个 group），否则请求会随机落到别的账号会话上。
- 灰度/调试：固定打到某台设备用精确 clientId；批量压测用 fuzzy 打到一批。

## 2. 并发与队列（最关键的认知）

**单个浏览器/frida 客户端是单线程的**——服务端虽然能同时收多个 HTTP 请求，但发给**同一个 client** 的请求在客户端侧是**串行执行**的（一个 message_id 一来一回）。所以：

- 单 client 的有效吞吐 ≈ `1 / 单次算法耗时`。算法 5ms → 理论 ~200 QPS；但加上 ws 往返与浏览器调度，实际远低。
- **横向扩并发**：在同一 group 注册 **N 个 clientId**（N 个标签页 / N 个浏览器实例 / N 台真机），服务端随机分流 ≈ N 倍吞吐。这是 JsRpc 提并发的唯一正道。
- **不要**指望在一个 client 里"多线程"——浏览器 JS 单线程，frida 也按消息排队。
- Python 端要并发就用线程池/异步同时打多个 HTTP 请求；服务端会把它们分散到 group 内不同 client（前提是注册了多个）。

### 消息匹配（原理）
每次调用服务端生成一个 `message_id` 随请求下发；客户端执行完把同一个 `message_id` + `response_data` 回传；服务端用 message_id 把结果对回到那个挂起的 HTTP 请求并返回。所以**客户端必须调用 resolve**（否则该 message_id 永远不回，HTTP 端挂到超时）。

## 3. 保活 / 重连

- **JsRpc HlClient**：`onclose` 与 `error` 后 **10 秒**自动 `connect()` 重连；连上 `open` 时自动 `_reportActions()` 重新上报所有已注册 action。`regAction` 时也会 `_reportActions`。
- **页面刷新/导航会断 ws** → 必须重新注入并重新 `new HlClient + regAction`。用油猴在 `document-start` 注入可缓解（见 injection-patterns.md）。
- **超时配置**：`config.yaml` 的 `DefaultTimeOut`（默认 30s）= 客户端无返回时 HTTP 端最多等多久。算法慢就调大；想快速失败就调小。
- **Sekiro**：长连接带心跳保活；客户端掉线后中心服务会从 group 摘除，调用打到该 group 的其他在线 client。

## 4. 排错速查（/go 返回异常时）

| 现象 | 最可能原因 | 处置 |
|---|---|---|
| 返回"超时"/挂满 DefaultTimeOut | action 名写错 / 客户端找不到该 action | `GET /list` 看客户端是否在线、action 是否上报；核对 `action=` 拼写 |
| 返回"action没找到" | 注册前页面刷新过、ws 断过没重连 | 重新注入 + `regAction` |
| 一直超时但函数手动能跑 | fn 走异步忘了 `resolve` | 异步分支务必 `resolve(...)`，或 `return` Promise |
| 偶发超时/结果串 | 单 client 被高并发打爆排队 | 同 group 加多 clientId 分流；Python 端限并发 |
| 结果是字符串化对象乱码 | param JSON 双重处理 | 多参数 Python 端 `json.dumps`；js 端框架会自动 `JSON.parse` |
| 连不上 | 服务端没起 / 端口/wss 协议不符 | 控制台看 `rpc连接出错` 日志；http→ws、https→wss |
| 别人能调你的接口 | `0.0.0.0` 暴露 | `config.yaml` 改 `127.0.0.1` 或加鉴权/防火墙 |

## 5. /list 输出的用法
`GET /list` 返回当前所有 group → clientId → 已注册 actions。每次怀疑"调不通"先看这里：客户端在不在、action 上没上报、是不是连错了 group。
