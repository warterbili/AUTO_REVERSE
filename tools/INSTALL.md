# 安装指南 (INSTALL)

> auto_reverse 的理念是 **collect + route，按需取用**：不需要一次装全部工具。
> 先装好基础运行时，再用 `fetch.py` 按需把单个工具下载到项目目录内（不污染全局）。

## 1. 基础运行时（手动装，一次性）

这些是大量工具的前置依赖，需自行安装并加入 PATH：

| 运行时 | 最低版本 | 用途 | 下载 |
|---|---|---|---|
| **Python** | 3.10+（3.14 实测可用） | pip 工具、adapters、`fetch.py`/`doctor.py` | https://www.python.org/downloads/ |
| **JDK** | 17+（Ghidra 12 需 JDK 21） | jadx / apktool / ghidra / unidbg | https://adoptium.net/ |
| **Node.js** | 18+ | apk-mitm / playwright / frida-il2cpp-bridge / 补环境框架 | https://nodejs.org/ |
| **adb / platform-tools** | 最新 | Android 设备交互、抓包、frida-server 推送 | https://developer.android.com/tools/releases/platform-tools |

校验：
```bash
python --version && java -version && node --version && adb version
```

> 完整运行时清单与检测命令见 `tools/registry.yaml`。

## 2. 工具安装目录

工具落在项目内，互不污染全局：
- pip 工具 → `<project>/.venv`
- npm / jar / zip 工具 → `<project>/tools/bin/<id>/`

可选：设环境变量 `AUTO_REVERSE_TOOLS` 指向一个统一的工具目录（见 `config/default.yaml` 的 `paths.tools_root_env`）。不设则默认用 `tools/bin/`。

## 3. 按需拉取工具（fetch.py）

```bash
python tools/fetch.py --list          # 列出所有可拉取工具
python tools/fetch.py jadx            # 下载 jadx 到 tools/bin/jadx/
python tools/fetch.py mitmproxy       # 装进项目 .venv
```
`fetch.py` 零三方依赖（仅用标准库 urllib/zipfile/lzma/venv），只下你要用的那一个。

## 4. 体检（doctor.py）

```bash
python tools/doctor.py                # 全量体检：已装/缺失
python tools/doctor.py --missing      # 只看缺失 + 对应 fetch 命令
python tools/doctor.py --domain android
python tools/doctor.py --json         # 给 brain/脚本消费
```
解析顺序：项目 `.venv` → 项目 `tools/bin` → 系统 PATH（已存在则不重复下载）。

## 5. 生成 .mcp.json（一键）

```powershell
# Windows
./setup.ps1
```
```bash
# macOS / Linux
./setup.sh
```
脚本读取 `mcp/mcp.template.json`，把 `${PYTHON}` / `${TOOLS_ROOT}` 占位符替换为本机实际路径，写出根目录 `.mcp.json`，并自动跑一次 `doctor.py`。

## 各 OS 注意点

- **Windows**：用 PowerShell 跑 `setup.ps1`；frida-server 需匹配设备 abi（本机记录见 `config/default.yaml`）。
- **macOS / Linux**：用 `setup.sh`；adb/fastboot 经包管理器装。
- **iOS 逆向**：需越狱设备或 sideload 工具（trollstore/sidestore），见 `catalog/ios.yaml`。
