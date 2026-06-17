# Castle.io `X-Castle-Request-Token` 逆向报告 — DailyPay (Android)

> 目标：DailyPay v48.0.0 依赖的 Castle.io 反机器人/设备指纹 SDK。
> 结论：**完整逆向并端到端验证**了 Castle Android SDK **v3.1.1**（代号 Highwind）的
> token 生成算法。该版本与公开开源资料（yubie-re/castleio-gen，v2.6.0/token v11）属同一
> 算法族，但**已发生关键漂移**——本报告以真机实测为准。

## 1. 目标与定位

| 项 | 值 |
|---|---|
| App | `com.DailyPay.DailyPay` v48.0.0（RN+Hermes+Expo） |
| 反 bot SDK | **Castle.io**，原生 Java `io.castle.android` **v3.1.1**（`BuildConfig.VERSION_NAME`） |
| 引擎 | `io.castle.highwind.android`（"Highwind"，70 个混淆类，纯 Java，无 .so） |
| 入口 | `Castle.createRequestToken()` → `Highwind.token()` → `u.g()` |
| 请求头 | `X-Castle-Request-Token`（120s 有效，每请求一个） |
| pk | `pk_` 开头、长度 35；实测已从 token 还原（脱敏 `pk_qVBR…6v`） |
| 次要指纹 | ThreatMetrix（`libTMXProfiling-rl-8.0-82-jni.so`）— 独立，不在本次范围 |

## 2. token 算法（v3.1.1，逐层）

整个 token 在**十六进制字符串域**里组装（每字节=2 hex 字符），最后 `unhex` 成字节再 base64url。

```
time      = unixSeconds - 1535000000                      # 同开源常量
nibble    = hex(rand(0..15))                               # 时间层 XOR key（1 nibble）
randByte  = rand(0..255)                                   # 末层 XOR key

# ① 指纹数据段 fpHex
fpMain    = f.a()                  # 主设备指纹（明文字段，见 §3）
partHdr   = (fpMain.size & 31) | 64
bPart     = r.a()                  # 次指纹段（idx=a()=6）
motion    = d.c()                  # 运动传感器（accel/gyro/magnetic/rotation/gravity/user-accel）
fpHex     = partHdr + fpMain.data + ((bPart.size&31)|((6&7)<<5)) + bPart.data + motion + "ff"

# ② 时间材料 string2（6 字节）
string2   = xor_and_append(BE4(time), nibble) + xor_and_append(BE2(time%1000的末3位), nibble)

# ③ 三层 XOR
strA4     = deriveKeyXor(key=string2, slice=4, rot=string2[3], data=fpHex)   # 时间层
uuidLayer = deriveKeyXor(key=uuidHex, slice=8, rot=uuidHex[9], data=string2+strA4)  # uuid 层
str4      = "0a" + hex(pk[3:]) + version(2B) + uuidHex(16B) + uuidLayer

# ④ 末层 + 封装
token     = base64url( unhex( hex(randByte) + xorHex(str4 + hex(len(str4Hex)&0xff), hex(randByte)) ) )
```

核心原语（DEX→语义，已逐一对照开源）：

| Highwind | 语义 | 开源等价 |
|---|---|---|
| `y.a(int)` | 字节→2hex；`y.c()` hex→字节 | `bytes.hex` / `unhexlify` |
| `q.a.a(int)` | 时间→4BE 字节，clamp `0x0FFFFFFF` | `encode_timestamp_to_bytes` |
| `q.a.a(hex,key)` | 半字节 XOR（key 循环） | `xor_hex_strings` |
| `q.a.a(ver,i)` | 版本位打包 `(patch&63)|(i<<13)|((major-1)&3)<<11|((minor&31)<<6)` | `decode_version_bytes` 逆 |
| `d0.a.a(hex,key)` | XOR 并追加 key | `xor_and_append_key` |
| `d0.a.a(key,slice,rot,data)` | 取前 slice、按 hex(rot) 旋转、XOR | `derive_key_and_xor_bytes` |
| `p0.a.a(str,255)` | UTF-8 编码（≤255B），**无加密** | （开源此处是 xxtea） |
| `z.a()` / `b0.a()` | 字段头 `((idx&31)<<3)|(type&7)` + 编码 | `process_fp_value` |
| `k.a.a(b)` | Base64 flag 11（url-safe 无填充） | `urlsafe_b64encode().rstrip("=")` |

字段类型枚举（同开源）：`1=UNK 3=B2H 4=SBA 5=B2H_WITH_CHECKS 6=B2H_ROUNDED 7=JUST_APPEND`。

## 3. 主指纹 `f.a()` 字段（真机实测，明文）

hook 到的 183 字节 `f.a()` 输出**全是明文**，含：
`Xiaomi`(厂商)、`zh-CN`(locale ×2)、`Android`、`cn`、`DailyPay`、`48.0.0`、
完整 UA `DailyPay/48.0.0 (510250072) (Castle 3.1.1; Android 13; Xiaomi MI 9)`、
`Asia/Shanghai`(时区)，以平台 enum / 屏幕 / 内存 / 时区偏移等 B2H 字段穿插，`0xff` 收尾。

## 4. 与开源资料的差异（本次核心结论）

公开资料（yubie-re/castleio-gen、yubie.dev、antibot.blog）覆盖 **Castle v2.6.0 / token v11（Web/JS）**，
作者明确不支持 v2.6.2+/V12。DailyPay 用的是 **v3.1.1**，实测差异：

| 维度 | 开源 v2.6.0 (v11) | DailyPay v3.1.1（实测） |
|---|---|---|
| 整体分组密码 | **XXTEA**(TEA_KEY) 包裹 + `0x0b` 版本字节 + padding | **无 XXTEA**；str4 直接进末层 XOR，首字节 `0x0a` |
| SBA 字段(type4) | 每字段 xxtea(key=[idx,init_time,…]) | **明文 UTF-8**（`p0.a.a`） |
| pk 位置 | header 里完整 pk | `str4` 内 `pk.substring(3)`（去 `pk_`） |
| 行为指纹 | 鼠标/触摸/键盘事件 datapoints | **设备运动传感器**（加速度/陀螺/磁力/旋转/重力/线性加速度） |
| 容器层 | timestamp/version/pk/uuid + xxtea | `0x0a`+pk体+version+uuid+uuidLayer，时间戳并入 uuid 层 |

**实证**：开源 `DecodeToken` 期望 post-XOR 首字节 `0x0b`，真实 token 给 `0x0a`，其 xxtea 步骤无对应 →
开源解码器在 v3.1.1 上产生乱码。→ **开源算法是正确的"族"，但对 v3.1.1 已过时，必须重新逆向**（本报告即是）。

## 5. 验证（金标准，Phase 7）

`tools/decode_v311.py`（自研、无 xxtea）对真实 token：
- 长度字节校验 **OK**；首字节 `0x0a` ✓
- 还原 **pk**（`pk_`+32，len 35）✓、**版本 3.1.1**（== BuildConfig）✓、**cuid**、**时间戳** ✓
- 剥离 3 层 XOR 后，**独立 hook 到的 `f.a()` 指纹（183B）原样出现在解码结果中**（紧跟 `0x58` part 头）→ 全链确认 ✓
- 两个 token：pk/cuid/version 恒定，仅时间/随机变化 → 确定性确认 ✓

## 6. 完整生成器（已实现 + 字节级验证）

`tools/gen_v311.py` —— 从原始设备字段构建合法 `X-Castle-Request-Token`，全链路自研。

**f.a() 24 字段全表**（逆向自 `f.a()` smali，运行时 z-hook 互证）：

| idx | 来源 | type | idx | 来源 | type |
|---|---|---|---|---|---|
| 0 | `g.b()&4` 特性位 | 4 | 15 | 应用名 | 5 |
| 1 | Build.MANUFACTURER | 5 | 17 | 应用 versionName | 5 |
| 2 | locale(`q0`) | 5 | 18 | 电池电量% | 6 |
| 3 | /proc/meminfo 内存GB | 7 | 19 | 电池充电态&3 | 4 |
| 4 | 屏幕宽/高÷density | 8 | 24 | **User-Agent** | 8 |
| 5 | /proc/cpuinfo 核数 | 6 | 25 | deviceIdSource | 4 |
| 6 | `e.f` | 6 | 26 | 时区ID | 5 |
| 7 | density | 7 | 27 | `g.e()` locale | 5 |
| 8 | `g.b` | 8 | 31 | 设备启动时间戳 | 8 |
| 9 | Build.MODEL | 5 | (20/21/22) | 运动传感器*条件* | 7 |
| 10 | `e.c()` | 8 | (23/28) | 定位*条件* | 5/8 |
| 11 | Build.VERSION.RELEASE | 5 | | | |
| 12 | "Android" | 5 | | | |
| 13 | 运营商名 | 5 | | | |
| 14 | 国家ISO | 5 | | | |

r.a() 14 字段：开机分钟、内存KB、屏幕方向、电池温度/电压/技术/健康、亮度、是否模拟器、ABI、JVM版本等。
字段类型映射 `c.a(i)=i-1`（内部 1..8 → wire 0..7）；归一化见 `z.<init>`。

**字节级端到端验证（`gen_v311.py verify`，全部 ✅）：**
- **Test A 指纹编码器**：从原始值（含 UA 现算）构建 24 字段 fp_main → 与真机 `f.a()` 输出**逐字节相同**。
- **Test B token 组装器**：从指纹 + 逐次随机量，把**真实抓取的 token 逐字节重建成功**。
- **Fresh 生成**：用当前时间生成全新 token，解码回 pk/版本 3.1.1/指纹**字节级往返一致**。

唯一未做：向 Castle 后端发送纯合成 token 验收（属对方服务器 + pk 脱敏，不进行）；
本地可达的最高标准（真实 token 逐字节复现）已通过。

## 6b. 复现路径

- 解码器：`tools/decode_v311.py <token_file> [fp_hex_file]`
- **生成器：`tools/gen_v311.py`（`verify` 子命令跑全部字节级验证）**
- hook：`scripts/hook_castle.js`（抓 token）、`scripts/hook_capture_one.js`（单次全量记录）

## 7. 复现脚本 / 产物清单

| 文件 | 说明 |
|---|---|
| `tools/decode_v311.py` | v3.1.1 token 解码+验证器（自研，已实测） |
| `scripts/hook_castle.js` | frida hook：createRequestToken / u.g / f.a / d.c |
| `workspace/03-static/dex7-src/sources/io/castle/highwind/android/` | 反编译的 Highwind 引擎源码 |
| `workspace/04-dynamic/captured_tokens.txt` `fp_data_main.hex` | 真机抓取样本（脱敏语境） |
| `docs/source-castleio-gen/` | 开源 v2.6.0 重实现（对照基准） |

## 8. 待办（移植到 auto_reverse 前）

- 枚举 `f.a()` 全部 24 字段语义（从抓取明文 hex + smali 补全），写完整 v3.1.1 **生成器**。
- 采集设备运动时的非零 motion 样本，确认浮点编码。
- 将本案例 + `castle-reverse` skill + `apk-acquire` skill 缺口一并整理进 `cases/` 与 `skills/`。
