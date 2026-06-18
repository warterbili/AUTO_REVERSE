# auto_reverse

> 全自动逆向 / 渗透测试 skill & MCP **收集 + 路由** 仓库。
> 喂给 AI 一个目标（APK / IPA / 网站 / PE），它按状态机自动判型、选工具、逆向、复现。
> *A "collect + route" catalog of fully-automated reverse-engineering & pentest skills and MCP servers.*

⚠️ **仅用于获授权的安全研究、CTF 与教学。** 使用者须对目标拥有合法授权，自行承担合规责任。

---

## 核心理念：收集 + 路由，而非集成

- `catalog/*.yaml` 是一份**可无限扩展的能力清单**（当前 **640+ 条**，`python catalog/validate.py` 可核计数）。
- 你**不必装全部**——AI 按任务只取一两个相关的；`bundled:true` 的随仓库自带（在 `skills/`），`bundled:false` 的用 `tools/fetch.py <id>` 按需下载到项目内（不碰全局）。
- `brain/` 是编排大脑：按 7 阶段状态机推进，靠 `catalog` 决定「调谁」、靠 `brain/decision-tree.md` + `brain/playbooks/` 决定「怎么做」。

## 架构

```
brain/                 编排大脑（orchestrator）
├─ SKILL.md            7 阶段状态机（intake→fingerprint→plan→static→dynamic→synthesize→verify）
├─ decision-tree.md    指纹 → 分析链路由表（Android / iOS / Web / Windows / Native / MCP）
└─ playbooks/          各目标形态的操作手册（android-*/ios-app/windows-pe）
catalog/*.yaml         能力清单（android/ios/native/windows/web/mcp/frameworks）+ SCHEMA.md
skills/<domain>/<id>/  随仓自带的 bundled skill（含 SKILL.md）
tools/                 fetch.py（按需下载）/ doctor.py（体检）/ registry.yaml（工具登记）
mcp/                   mcp.template.json（占位符模板，setup 脚本据此生成 .mcp.json）
config/                default.yaml（全局配置；local.yaml 本地覆盖，gitignored）
cases/                 脱敏的真实案例记录（committed）
workspace/             每个目标的产物目录（gitignored）
```

## 快速开始

```bash
# 1. 装基础运行时（Python 3.10+ / JDK 17+ / Node 18+ / adb），详见 tools/INSTALL.md
# 2. 体检：看本机已装/缺啥
python tools/doctor.py

# 3. 生成 .mcp.json（把模板占位符替换为本机路径 + 自检）
./setup.ps1            # Windows (PowerShell)
./setup.sh             # macOS / Linux

# 4. 按需拉取某个工具
python tools/fetch.py --list
python tools/fetch.py jadx

# 5. 喂目标给 brain（在 Claude Code 里触发 brain skill），它自动走 7 阶段流程
```

## 路由概览（decision-tree）

| 目标 | 入口判型 → 路由 |
|---|---|
| **Android** | 脱壳？→ 框架（Flutter/RN-Hermes/Unity）→ 纯 Java vs native 签名 → 对应 playbook |
| **iOS** | 砸壳（frida-ios-dump/bagbak）→ class-dump/dsdump → objection-ios 动态 → 复现/注入 |
| **Web** | 厂商判型（PerimeterX/Akamai/Cloudflare/DataDome/瑞数/Castle/极验）→ 验证码 → 签名复现（纯算 / JsRpc / 补环境） |
| **Windows** | DIE 判型 → 脱壳 → .NET(dnSpy) vs native(ghidra/x64dbg) |
| **Native** | capa 分流 → ghidra/ida/binja 反编译 → 反混淆 → unidbg/qiling 模拟 → bindiff |
| **MCP** | 任一工具若有 MCP，优先让 AI 直接驱动（自主 read→act 循环） |

## 贡献

新增一条能力：编辑对应 `catalog/*.yaml`，按 `catalog/SCHEMA.md` 的字段填写（重点写好 `when_to_use` 路由行），`bundled:true` 的把 skill 放进 `skills/<domain>/<id>/`。提交前跑 `python catalog/validate.py`。

## 合规声明

本项目仅供**授权范围内**的安全研究、CTF 竞赛与教育用途。不提供任何盗版工具；商业工具（IDA/Hopper/Binary Ninja 等）需自备授权。请遵守目标的服务条款与所在地法律。
