# `tools/` — the runnable toolbox

Flat by design: these are peer **CLI entrypoints**, invoked by exact path
(`python tools/<name>.py …`) and referenced across the repo. This index is the map — no
sub-folder nesting (which would only lengthen the invocation paths).

## 🤖 Autonomy spine — drive a run from zero

| Tool | What it does |
|---|---|
| **`auto_reverse.py`** | **The headless from-zero driver.** `python tools/auto_reverse.py <apk\|package-id\|url>` runs intake → fingerprint → **unpack (auto frida-dexdump if a packer is detected + a device is present)** → plan → static → native (auto-targets the .so), writes every artifact + `status.json` + `report.md`. Resumable. **Missing tools (jadx/ghidra/frida-dexdump/…) are auto-fetched into the project** (`tools/bin` / `.venv`) via `fetch.py`, then used — so it works on a fresh clone. `--auto-capture` adds a hands-off dynamic capture; phases needing a device/GUI/human become explicit `next_actions` (never faked). |
| **`oracle.py`** | **Phase-7 verifier.** `oracle.py replay --from 06-synthesize/request.json --expect-status 200` — replays a synthesized request and judges the response (exit 0 = VERIFIED, 1 = REJECTED). What makes a run self-checking instead of hallucinated. |
| **`workspace.py`** | `workspace.py init <target>` — scaffold `workspace/<slug>/{00-intake … 07-verify}` + a `meta.json` stub. |

## 🔧 Provisioning & environment

| Tool | What it does |
|---|---|
| **`doctor.py`** | Environment health check — what's installed / missing across android/native/web/runtime (+ device-side frida-server). `--json` for agents, `--missing` for the fetch list. |
| **`fetch.py`** | On-demand provisioning. `fetch.py <id>` installs **any** catalog/registry tool (pip→project venv, npm/git→`tools/bin/`). `--list` shows the curated set. |
| **`smoketest.py`** | Catalog reliability. `lint` (offline: install schemes, placeholders, source URLs — CI gate) · `probe` (online: does the pip/npm package / git repo actually exist — catches dead entries). |
| **`doccheck.py`** | Doc-drift gate (CI): verifies the README counts (catalog total, per-domain floors, exact skills count) still match the live `catalog/`+`skills/`. Stops `640+`/`125+`-style staleness. See the upgrade matrix in `.github/CONTRIBUTING.md`. |

## 🔬 Phase helpers (called by `auto_reverse.py`, also usable standalone)

| Tool | What it does |
|---|---|
| **`fingerprint.py`** | Phase 1: scan an APK (+ splits) → schema-conforming `fingerprint.json` (framework / packer / RASP / anti-bot, dex count, auto coverage-check against `catalog/targets.yaml`). |
| **`hermes_strings.py`** | Dump a React-Native **Hermes** bundle's string table one-per-line (plain `strings` fails on Hermes). Accepts an `.apk` directly; auto-uses the venv's `hermes-dec`. |
| **`ui_exercise.py`** | Unattended Android UI driver (pure adb: launch + `uiautomator dump` element-find + `input tap/swipe`). Replays a recorded `--flow` file or does a `--generic` exercise so a capture session records real traffic hands-off. |

## 📦 Internal / data (not CLI entrypoints)

| File | What it is |
|---|---|
| `_toolspec.py` | Shared tool specs (paths, install kinds) imported by `doctor.py` / `fetch.py`. |
| `registry.yaml` | The curated install registry `doctor.py` checks and `fetch.py` / `smoketest.py` read. |
| `adapters/` | Runtime adapters (e.g. `frida_server.py` — detect/push/start frida-server on a device). |
| `ghidra_scripts/` | Headless Ghidra scripts (`DumpDecomp.java` — decompile every function, used by the native phase). |
| `INSTALL.md` | Per-OS install guide for the base runtimes + on-demand tools. |

> New tool? Keep it a flat `tools/<name>.py` CLI with a docstring usage block, and add a row here.
