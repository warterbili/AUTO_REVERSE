# DailyPay 注册 403 诊断报告（与 Castle 服务器级 E2E 的边界）

> 起因：尝试做 Castle "服务器接受级"端到端验证时，发现注册（signup）请求被 403 拒绝。
> 本文记录对这个 403 的系统性定因，结论：**与 Castle 无关，是 CloudFront 边缘策略门**。

## 1. 被拦的请求（真机抓包，frida 进程内 hook）

```
POST https://employees-api.dailypay.com/v2/signup_users   →  403 Forbidden
请求头（节选）：
   x-castle-request-token: <1602 chars>          ← 这接口在 Castle 白名单内
   x-castle-client-id:     <cuid>
   x-app-bundle: com.DailyPay.DailyPay
   x-app-version: mobile
请求体：{"email":"<redacted>","password":"<redacted>","referral":{},
        "country":"USA","language_preference":"en","use_jwt":true}
响应头（决定性）：
   server: CloudFront
   x-cache: LambdaGeneratedResponse from cloudfront     ← Lambda@Edge 在边缘直接生成 403
   via: 1.1 …cloudfront.net (CloudFront)
   x-amz-cf-pop: LAX54-P11
   content-length: 0                                     ← 空响应体
```

CDN 区分：注册接口 `employees-api.dailypay.com` = **AWS CloudFront**；市场站 `get.dailypay.com` = **Cloudflare**（不同基础设施）。拦截发生在 **CloudFront 的 Lambda@Edge**。

## 2. 变量逐一证伪（直接对照实验）

| 变量 | 实验方法 | 结果 |
|---|---|---|
| Castle token / 设备指纹 | 裸请求（无 token、无指纹）curl | ❌ 仍 403 |
| 客户端类型 | 原生 app / web 浏览器 / curl | ❌ 三者都失败 |
| IP 地理（国家） | 美国边缘（LAX/IAD/DFW/MSP/BOS） | ❌ 仍 403 |
| IP 信誉 / 数据中心 | 两台美国 VPS（ByteVirt/达拉斯） | ❌ 仍 403 |
| **IP 真住宅** | ScrapeOps 住宅代理，真美国 ISP（Charter/Spectrum，3 个不同住宅 IP） | ❌ 仍 403 |
| **TLS / JA3 指纹** | curl-cffi 伪装 Chrome / Safari-iOS | ❌ 仍 403 |
| User-Agent / app 头 | 浏览器 UA、全套 app 头（x-app-bundle/version 等） | ❌ 仍 403 |

**共同点**：所有 403 都是同一个 `LambdaGeneratedResponse from cloudfront`，与上述任一客户端可控变量无关。

## 3. 关键观察

- **真机正版 app 的 signup 也是 403** → 这个 403 **不是"被识别为机器人/被检测"**，而是该接口对此次注册本身就拒绝（与用户"根本注册不了"的体验一致）。
- 请求体 `"referral":{}` 为**空**。结合 DailyPay 是**雇主中介式注册**（员工须通过雇主专属链接、匹配雇主员工库），最合理解释：

> **Lambda@Edge 在边缘要求有效的雇主/邀请（referral）上下文；空 referral 的自助注册被边缘 403。** 真正可注册的是"合作雇主在职员工经雇主专属链接"进入的请求。

（未 100% 坐实——需一个真实雇主邀请链接对照——但能解释全部现象，且 IP/TLS/Castle/指纹均已实验排除。）

## 4. 结论

1. **403 是 CloudFront Lambda@Edge 的策略/资格门，不是反爬检测**。住宅代理、undetectable browser、改设备指纹、TLS 伪装**全部无效**（已逐一证伪）。
2. **与 Castle 无关**。Castle token 正常生成；它前面还有这道边缘门挡着，请求根本到不了源站做 Castle 风控。
3. **对 Castle 服务器级 E2E 的影响**：因为注册被边缘拦在 Castle 之前、且无合格员工账号，**"服务器接受我们生成的 token" 这一步在当前条件下无法完成**。可达的最高验证仍是已完成的**本地字节级复现**（自生成 token 与真实 token 逐字节一致，服务端无法区分）。

## 5. 若要继续打通注册（与逆向 Castle 无关）

需要同时满足（按拦截先后）：① 一个**有效的雇主/referral 上下文**（合作雇主的专属注册链接）；② 是该雇主**在职且符合条件的员工**。这两道都是 DailyPay 业务策略，跟 IP/TLS/Castle/指纹无关。

## 附：工具与证据
- 抓包脚本：`scripts/hook_flow_all.js`、`hook_signup_capture.js`
- 原始日志：`flow_all.log`、`flow_newnode.log`、`signup_capture.log`、`http_diag.log`
- 住宅 IP / TLS 测试：ScrapeOps 住宅代理（country=us）+ curl-cffi（impersonate chrome/safari）
