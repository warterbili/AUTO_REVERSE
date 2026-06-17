# 移动端 Akamai BMP 协议参考（Bot Manager Premier mobile SDK）

> 基于 `xvertile/akamai-bmp-generator` 源码整理（Go，全量逆向）。这是本 skill 唯一开箱即用的路径。
> 协议字段名/序号/加密链均来自 `bm/<version>/bm.go` + `sdk/sdk.go`，非记忆。

## 1. 为什么移动端有现成实现而 Web 没有

- 移动端 BMP 是 App 内嵌的 native/Java SDK，协议（pipe 序列化 + 固定加密链）跨版本相对稳定。
- 设备指纹是 Android `Build.*` 静态字段 + 可合成的 motion/触摸，**可以池化**（2K 真实设备就够）。
- Web 端采集脚本逐站点定制 + 频繁换版 + canvas 不可伪造 + 强依赖真实行为，无法做成通用库。

## 2. pipe 序列化协议

`SerializeBmp(pairs)`：每个有 id 的字段输出 `-1,2,-94,<id>,<value>`，无 id 的直接输出 value 拼接。

3.3.4 的字段装配顺序（`GenerateSensorData`）：

| id | 含义 | 生成方式 |
|---|---|---|
| 首段（无 id） | `BMPVERSION`，如 `3.3.4` | 常量，**pin 对目标** |
| `-90` | challenge 信息（仅 `challenge:true` 时） | `cf-sdk-1-00-0.js#model=...#sdkVersion=...` |
| `-70`/`-80`/`-121` | 空 | `""` |
| `-100` | **系统信息** | 见 §3 |
| `-101` | event listeners | 常量 `do_en,dm_en,t_en` |
| `-102` | eact | 通常空 |
| `-103` | 后台事件 | `GetBackgroundEvents`：随机 `action,ts;` 序列 |
| `-104` | 常量 | `-2,3,-50,-301,null` |
| `-108` | text change | 空 |
| `-112` | **性能基准** | `PERF_BENCH`（device 池字段，如 `17,906,59,...`） |
| `-115` | **校验统计** | 见 §4，最关键 |
| `-117` | 触摸事件 | `GenerateTouchEvents`：`action,time,0,0,1,1,1,-1;` |
| `-120` | 空 | |
| `-142`/`-144`/`-160` | 方向（orientation）数据 | 3.3.4 默认注释掉，可能空 |
| `-143`/`-145`/`-161` | **motion 数据** | `GenerateMotionString`：加速度计/陀螺仪 |
| `-150` | 常量 | `1,0` |

不同版本字段集略有差异（这就是版本必须 pin 对的原因）。

## 3. `-100` 系统信息字段（device 指纹来源）

`GetSystemInfo` 用 `UrlEncode` 拼接（注意是 Akamai 自定义 UrlEncode，大写十六进制、保留部分 ASCII）：
屏幕 height/width、电量、orientation、`lang`、`Build.VERSION.RELEASE`、`MODEL`、`BOOTLOADER`、`HARDWARE`、`app`(包名)、androidId、SDK_INT、`MANUFACTURER`、`PRODUCT`、`TAGS`、`TYPE`、`USER`、`DISPLAY`、`BOARD`、`BRAND`、`DEVICE`、`FINGERPRINT`、`HOST`、`ID` …
末尾追加 `Ab(systemInfo)`（ASCII<128 求和校验）+ 随机 int + `startTime/2`。

device 结构（`dm/device.go`）：`SCREEN`、`PERF_BENCH[]`、`BUILD{MANUFACTURER,HARDWARE,MODEL,BOOTLOADER,VERSION{RELEASE,CODENAME,INCREMENTAL,SDK_INT},PRODUCT,TAGS,TYPE,USER,DISPLAY,BOARD,BRAND,DEVICE,FINGERPRINT,HOST,ID}}`。
`androidId`：SDK_INT≥26 用 16 hex（`GenAndroidId`），否则 UUID。

## 4. `-115` 校验统计（GetVerifyStats，错了直接挂）

```
0,<touchVel>,<d>,<d2>,<longValue>,<time>,0,<touchSteps>,<shifta>,<shiftb>,<r1>,<r2>,0,<FeistelEncode(longValue, touchSteps+shifta+shiftb, time)>,<startTime>
```
- `time = now - startTime`
- `longValue = d2 + touchVel + d`（motion/触摸累加值，由 `CreateMotionPair` 的 value 求和而来）
- `r1 = rand(4,16)*1000`，`r2 = rand(15,53)*1000`
- `FeistelEncode`：16 轮 Feistel，把统计量编码成一个校验整数。**这是 motion/触摸/时间的一致性校验，随机乱填会被识破。**

## 5. motion 数据（-143）

`GenerateMotionString` → `CreateMotionPair`：
- 生成加速度计/陀螺仪角度序列（`GenGenericEvents` lerp 插值 + 噪声）
- `BmpHash`：把 float 序列量化成 65(`A`)..`}` 的字符（60 桶），处理 `\`/`.` 转义
- `ShortenBmpHash`：游程压缩；`HashF7`：CRC-like 32 位查表 hash（`f7912a` 表）
- 长度是 2 的幂时走 DCT 变换（`aeA`/`agA` 阈值置零）分支
- 输出 `2;<low>;<high>;<hashF7>;<shortHash>` 形式，多轴用 `:` 连接

## 6. 加密链（EncryptSensor）

```
aeskey = 随机16B
aesKeyEncrypted = base64( RSA-PKCS1v15( aeskey, rsaPubKey ) )
hmacKey = 随机16B
hmacKeyEncrypted = base64( RSA-PKCS1v15( hmacKey, rsaPubKey ) )

doFinal, iv = AES-128-CBC( sensorPlain, aeskey )    // PKCS5 padding, 随机 IV
obj = iv || doFinal
mac = HMAC-SHA256( obj, hmacKey )
encryptedData = base64( obj || mac )

最终 sensor = "1,a,<aesKeyEncrypted>,<hmacKeyEncrypted>$<encryptedData>$1000,1000,1000"
（GenerateSensorData 还会再拼成 <encrypted>$<powResponse>$<powToken>）
```
`rsaKey` 是硬编码在每个版本 `bm.go` 里的 Akamai 公钥（base64 DER）。

## 7. Proof-of-Work（仅 challenge:true）

`GetPowParams`：GET `http://<domain>/_bm/get_params?type=sdk-pow` → `{nonce,difficulty,checksum,mode}`。
`SolvePow`：暴力找 `format` 使 `FindPowAnswer(SHA256(androidId+uptime+nonce+(difficulty+i)+format), difficulty+i)==0`，做 10 个难度递增的解。
拼成 `androidId;uptime;nonce;difficulty;checksum;<answers>;<iterations>;<elapsed>`。
**站点没开 PoW 就别做**（`challenge:false`，`GetPowResponse` 直接返回空）。

## 8. 用 generator

```bash
git clone https://github.com/xvertile/akamai-bmp-generator
cd akamai-bmp-generator/cmd/akamai-bmp-server   # 或 ./server
go run main.go --host localhost --port 1337 --devicepath db/devices.json
```
POST `/akamai/bmp`：
```json
{"app":"com.target.app","lang":"en_US","version":"3.3.4","challenge":false,"powUrl":"https://m.target.com"}
```
返回 `{"sensor","androidVersion","model","brand","screenSize","userAgent"}`。
支持版本：2.1.2 / 2.2.2 / 2.2.3 / 3.1.0 / 3.2.3 / 3.3.0 / 3.3.1 / 3.3.4 / 3.3.9 / 4.0.2 / 4.2.1。

## 9. 如何 pin 对版本（jadx / frida）

- **jadx**：反编译 App，搜字符串 `Akamai BMPSDK/`（UA 模板 `Akamai BMPSDK/<version> (Android; ...)`）或类名含 `bmsdk`/`BotManager`。版本号即 BMP version。
- **frida**：hook sensor 生成的返回点，dump 出 sensor 串 —— pipe 串第一段就是版本号（如 `3.3.4`）。同时对照真实 sensor 的字段集与 generator 输出 diff，确认协议一致。
- 版本不对 → 字段序号/集合/协议头不匹配 → 即便加密正确也 403。

## 10. 通过率工程（移动端）

- TLS：Go `bogdanfinn/tls-client`（impersonate okhttp/chrome），Python `curl_cffi`。
- 设备池：扩充真实 `devices.json`，一机一指纹，避免高并发复用同一指纹。
- IP：住宅/移动 IP，换 IP；单 IP 高并发会被拉黑。
- abck 握手：见 SKILL.md 状态机；每次回写 `_abck`/`bm_sz`。
