# Installation Guide (INSTALL)

> The philosophy of auto_reverse is **collect + route, fetch on demand**: you do not need to install every tool at once.
> First set up the base runtimes, then use `fetch.py` to download individual tools into the project directory on demand (without polluting the global environment).

## 1. Base Runtimes (install manually, one-time)

These are prerequisites for a large number of tools; install them yourself and add them to PATH:

| Runtime | Minimum Version | Purpose | Download |
|---|---|---|---|
| **Python** | 3.10+ (3.14 verified working) | pip tools, adapters, `fetch.py`/`doctor.py` | https://www.python.org/downloads/ |
| **JDK** | 17+ (Ghidra 12 requires JDK 21) | jadx / apktool / ghidra / unidbg | https://adoptium.net/ |
| **Node.js** | 18+ | apk-mitm / playwright / frida-il2cpp-bridge / environment-supplementation frameworks | https://nodejs.org/ |
| **adb / platform-tools** | latest | Android device interaction, traffic capture, frida-server push | https://developer.android.com/tools/releases/platform-tools |

Verify:
```bash
python --version && java -version && node --version && adb version
```

> See `tools/registry.yaml` for the full runtime list and detection commands.

## 2. Tool Installation Directory

Tools land inside the project, keeping the global environment clean:
- pip tools → `<project>/.venv`
- npm / jar / zip tools → `<project>/tools/bin/<id>/`

Optional: set the environment variable `AUTO_REVERSE_TOOLS` to point to a unified tools directory (see `paths.tools_root_env` in `config/default.yaml`). If unset, it defaults to `tools/bin/`.

## 3. Fetch Tools On Demand (fetch.py)

```bash
python tools/fetch.py --list          # List all fetchable tools
python tools/fetch.py jadx            # Download jadx to tools/bin/jadx/
python tools/fetch.py mitmproxy       # Install into the project .venv
```
`fetch.py` has zero third-party dependencies (uses only the standard library: urllib/zipfile/lzma/venv) and downloads only the one tool you need.

## 4. Health Check (doctor.py)

```bash
python tools/doctor.py                # Full health check: installed/missing
python tools/doctor.py --missing      # Show only missing + corresponding fetch commands
python tools/doctor.py --domain android
python tools/doctor.py --json         # For consumption by the brain/scripts
```
Resolution order: project `.venv` → project `tools/bin` → system PATH (skips re-downloading if already present).

## 5. Generate .mcp.json (one-click)

```powershell
# Windows
./setup.ps1
```
```bash
# macOS / Linux
./setup.sh
```
The script reads `mcp/mcp.template.json`, replaces the `${PYTHON}` / `${TOOLS_ROOT}` placeholders with the actual local paths, writes out `.mcp.json` in the root directory, and automatically runs `doctor.py` once.

## Per-OS Notes

- **Windows**: run `setup.ps1` with PowerShell; frida-server must match the device abi (local records in `config/default.yaml`).
- **macOS / Linux**: use `setup.sh`; install adb/fastboot via your package manager.
- **iOS reversing**: requires a jailbroken device or sideload tooling (trollstore/sidestore), see `catalog/ios.yaml`.
