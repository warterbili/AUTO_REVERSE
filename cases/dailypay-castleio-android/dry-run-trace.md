# Brain Dry-Run Trace — dailypay-castleio-android

> 回归验证：拿本案的 `fingerprint.json` 当输入，沿 `brain/SKILL.md` 7 阶段 + `brain/decision-tree.md`
> 走一遍，确认每个路由落点都真实存在、不踩死路。日期 2026-06-18。

## 输入（fingerprint.json 摘要）
- 目标：`com.DailyPay.DailyPay v48.0.0`（Android，未加固，classes..classes9.dex 完整）
- 框架壳：React Native + Hermes + Expo（`libhermes.so` + `index.android.bundle` 12.3MB）
- **任务目标**：Castle.io 反爬 token `X-Castle-Request-Token`，SDK 在 **native Java** `io.castle.android`（疑似 v2.9.0）
- 旁路：ThreatMetrix（device fp，out of scope）、libthemis_jni.so（Themis crypto）、rootbeer + libtoolChecker（疑 RASP）

## 逐阶段追踪

| Phase | 决策 | 路由落点 | 存在? |
|---|---|---|---|
| 0 Intake | `.apk` → android | — | ✓ |
| 1 Fingerprint | 未加固；**第三方风控 SDK = io.castle.android（优先于框架分支）** | **skill: castle-reverse** | ✓ |
| | （壳是 RN Hermes，但 Castle token 不在 Hermes bundle 里——框架分支让位） | playbook android-rn-hermes（仅当要扒 app 自身 JS API 时） | ✓ |
| 2 Plan | 选 castle-reverse + android-java-sign 式 jadx 链 | castle-reverse / android-java-sign | ✓ |
| 3 Static | jadx 反编译 io.castle.android，读 createRequestToken 装配链 | jadx-reverse-engineering / android-re-decompile | ✓ |
| 4 Dynamic | frida hook createRequestToken 确认 in→out；ssl/root 旁路 | frida-hooking / frida-mitm-capture / objection-runtime | ✓ |
| 4 旁路 | RASP（rootbeer + libtoolChecker）→ 正交反制 | decision-tree Android「Stacked protections」 | ✓ |
| 旁路 | Themis/native libs 若需深挖 → Native 段 | capa-triage → ghidra-reverse-engineering | ✓ |
| 5 Synthesize | 复现 token；castle-reverse 覆盖 v3.1.1 android-native + web v11 | castle-reverse 生成器 | ✓* |

\* v2.9.0 是否与 castle-reverse 现有实现一致需逐目标验证——这是**目标特异性**问题，非路由死路。

## 发现并修复的缺口（dry-run 的价值）

**问题**：Android 段原先只按「框架」和「核心逻辑位置」路由，**没有「目标是第三方风控 SDK」的规则**。
本案壳是 RN Hermes，按原 `Framework?` 分支会被送去 `android-rn-hermes`，而真正能处理 Castle 的
`castle-reverse`（明确支持 `io.castle.android`）只能从 **Web 段**够到——可一个 Android 目标根本不会去查 Web 段。
→ 误路由 / 隐性死路。

**修复**（本次 commit）：
1. `decision-tree.md` Android 段在「packed?」之后、「Framework?」之前，新增**优先级最高**的
   「目标是否已知第三方 anti-bot/风控 SDK」分支：io.castle.android→castle-reverse、PerimeterX→px-reverse、
   Akamai→akamai-reverse、其余→Web 厂商表。明确「SDK token 在 native Java/.so，与 RN/Flutter 壳无关，
   优先于框架分支」。
2. `brain/SKILL.md` Phase 1 Android 指纹矩阵新增「第三方风控 SDK」行，标注优先于框架行。

## 结论
修复后，本案 7 阶段全程**无死路**，所有路由落点（skill/playbook/catalog）均经程序化校验存在。
原优化计划第 5 节最后一项「端到端 dry-run」达成。
