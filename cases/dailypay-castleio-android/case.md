# 实战案例：DailyPay (Android) × Castle.io 反 bot token 逆向

> 目标 App：`com.DailyPay.DailyPay` v48.0.0 ｜ 目标 SDK：Castle.io `io.castle.android` **v3.1.1**（引擎代号 Highwind）
> 结果：**完整逆向 + 本地字节级端到端验证**了 `X-Castle-Request-Token` 生成算法，产出可用生成器。
> 复用能力见 skill：[`skills/web/castle-reverse`](../../skills/web/castle-reverse/SKILL.md)

## 一句话结论
DailyPay 的 Castle token = **十六进制组装的设备指纹 + 3 层半字节 XOR（时间层 slice4/rot3、uuid 层 slice8/rot9、随机字节层）+ base64url**，**没有任何分组密码（XXTEA 已被去掉）**。与开源 `castleio-gen`（web v2.6.0/token v11）属同族但已漂移，**开源解码器在本目标上失败**，必须重逆——本案例即完成了重逆并字节级验证。

## 按 auto_reverse 7 阶段法的过程

**Phase 0 Intake**：设备/磁盘均无 APK → 用新建的 `apk-acquire` skill 从 APKPure 自动下载 v48.0.0 XAPK（base+3 split），`adb install-multiple` 装到真机。

**Phase 1 Fingerprint**：RN+Hermes+Expo 应用；DEX 内含 `io.castle.android`（39 处）+ `createRequestToken` + `X-Castle-Request-Token`；另有 ThreatMetrix（次要，不在范围）。token 在原生 Java，非 .so/JS → 走标准 jadx Java 链。详见 `fingerprint.json`。

**Phase 3 Static**：jadx 反编译 → 入口链 `createRequestToken() → Highwind.token() → u.g()`；引擎 `io.castle.highwind.android` 70 个混淆类。逐一还原原语（`q/d0/y/p0/z/b0/c/k`），确认 **无 XXTEA/AES/Cipher**；`f.a()`（主指纹）jadx 失败 → 用 `--show-bad-code` + 运行时 hook 补全。详见 `static-findings.json` 与 skill 的 `references/algorithm-v3.1.1-android.md`。

**Phase 4 Dynamic**：frida hook `createRequestToken/u.g()/f.a()/d.c()` 抓到**真实 token + 明文指纹**——指纹 hex 里 `Xiaomi/zh-CN/Android/DailyPay/48.0.0/完整 UA/Asia/Shanghai` 全是明文，**动态实锤 SBA 无加密**。再 hook `z` 构造器在运行时枚举全部 24 字段 (idx,value,type)。详见 `dynamic-findings.json`。

**Phase 6/7 Synthesize+Verify**：实现完整生成器 `gen_v311.py` + 解码器 `decode_v311.py`，三项**字节级验证全过**：
- 从原始设备值从零构建 24 字段指纹 == 真机 `f.a()` 输出（逐字节）；
- 从指纹 + 逐次随机量重建**真实 token == 抓取 token**（逐字节）；
- 全新生成 token 解码往返一致（pk `pk_`+35 / 版本 3.1.1 / cuid / 时间戳）。
完整报告见 `report.md`。

## 与开源资料的关键差异（本案例的核心价值）
开源覆盖 web v11；本目标 v3.1.1 实测：**去掉了 XXTEA（整体+每字段）**、**SBA 字段明文 UTF-8**、**行为指纹换成设备运动传感器**、pk 去前缀内嵌、容器布局重排。开源 `DecodeToken` 期望 `0x0b`+xxtea，真实 token 是 `0x0a`+无 xxtea → 失败。详见 skill 的 `references/opensource-vs-v311.md`。

## 边界：为什么"服务器接受级 E2E"没做完
尝试把自生成 token 发给 DailyPay 后端验收时，注册接口 `POST employees-api.dailypay.com/v2/signup_users` 返回 **403**。系统排查（真美国住宅 IP / TLS 指纹伪装 / Castle token / 设备指纹 / UA / app 头逐一证伪）确认：**这是 CloudFront Lambda@Edge 的策略/资格门，与 Castle 无关**（真机正版 app 也 403，空 `referral:{}` 指向雇主资格）。所以服务器级验收受阻于 Castle 之前的业务壁垒，本地可达的最高标准（字节级复现）已完成。详见 `signup-403-diagnosis.md`。

## 暴露并已修复的项目缺口
- **`apk-acquire` skill**（新增）：auto_reverse 原 Phase 0 无"APK 自动获取"能力，本案例补齐（adb pull → 本地 → APKPure 直链 + 校验 + 可选安装）。

## 产物清单
| 文件 | 说明 |
|---|---|
| `report.md` | 综合报告（算法 + f.a() 全表 + 验证结果） |
| `signup-403-diagnosis.md` | 注册 403 定因（非 Castle，CloudFront 边缘门） |
| `fingerprint.json` / `static-findings.json` / `dynamic-findings.json` | 各阶段产物 |
| skill `castle-reverse`：`tools/gen_v311.py`、`tools/decode_v311.py`、`scripts/hook_*.js`、`source-castleio-gen/`、`references/*` | 可复用能力 |

## 复现
```bash
# 生成器自检（字节级验证）
python skills/web/castle-reverse/tools/gen_v311.py verify
# 解码真实 token
python skills/web/castle-reverse/tools/decode_v311.py <token_file>
```
