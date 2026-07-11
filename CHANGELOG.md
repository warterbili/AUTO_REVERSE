# Changelog

All notable changes to auto_reverse are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Upgrade sync-matrix + drift guard** — a "when you change X, also update Y" matrix in
  `.github/CONTRIBUTING.md`, plus `tools/doccheck.py` (CI-gated) that verifies the README
  counts (catalog total, per-domain floors, exact skills count) still match the live
  `catalog/`+`skills/`. Stops `640+`/`125+`-style count drift mechanically.
- **`AGENTS.md`** — onboarding for an AI/agent picking up the repo: what the project is,
  the catalog↔brain mental model, the entrypoints, and the non-obvious operating rules
  (check coverage first, verify via oracle, headless over GUI, English-only, desensitize)
  that can't be cheaply inferred by scanning. Plus **`tools/README.md`** indexing every tool.
- **Autonomy layer — the project is now AI-auto-executable from zero:**
  - `tools/auto_reverse.py` — one headless command takes a bare target (apk / package-id /
    url) and drives intake → fingerprint → plan → static → native, writing every artifact
    plus a machine-readable `status.json` and `report.md`. Resumable; phases needing a
    device/GUI/human are emitted as explicit `next_actions` with the exact command — never faked.
    - **Auto-unpack**: when the fingerprint flags a packer (Tencent Legu / Bangcle / 360
      etc.) and a device + frida-server are present, runs `frida-dexdump` to dump the
      released DEX from memory into `unpacked/` (else an honest `needs_device` hand-off).
      Also flipped the `android-unpacking` skill `archived → active`.
    - **Native auto-targeting**: ranks every `.so` across the splits by detection/crypto
      signal (name + raw-bytes scan for frida/ptrace/maps/AES/HMAC/…, framework libs
      penalised), auto-extracts the top-scored one, and decompiles it headlessly via
      `tools/ghidra_scripts/DumpDecomp.java` — no human picks the target. (On PrizePicks it
      auto-selected `libtampering-detection.so`, score 70 vs 18, and recovered the Xpoint
      `FridaNativeBridge` JNI exports.)
    - **Dynamic auto-detect + unattended capture**: probes for an adb device + a running
      frida-server; with `--auto-capture` it runs a hands-off session —
      `start_capture` (frida+mitm, background) → `tools/ui_exercise.py` drives the app's UI
      (pure-adb: launch + `uiautomator dump` element-finding + `input tap/swipe`; replays a
      recorded `--flow` file or does a generic exercise) → `stop_analyze` → `04-dynamic`.
      Without the flag it tees up the exact command (status `ready`). Catalogued
      `uiautomator2` as the optional richer UI backend.
  - `tools/oracle.py` — Phase-7 verification: replay a synthesized request and judge the
    response (exit 0 = VERIFIED, 1 = REJECTED), so a run is self-checking instead of
    hallucinated. Wired into `brain/SKILL.md` Phase 7.
  - `tools/smoketest.py` — turns the catalog from an unverified index into a tested one:
    `lint` (offline structural gate, now in CI) + `probe` (online existence check that
    catches dead repos / non-existent pip/npm packages — the class of bug found by hand).
  - `workspace/README.md` documents the per-target reversing workspace.
- **AI/LLM-assisted RE capabilities** — catalogued neural decompilers and decompiler LLM
  plugins: `sk2decompile` (two-phase skeleton→skin), `resym` (variable/struct recovery),
  `gepetto` + `aidapal` (IDA LLM plugins), `awesome-info-inferring-binary` (ReSym/TYGR/Idioms
  index) in `native.yaml`; `humanify` (LLM JS un-minify via oxc) and `jsir` (Google's JS IR /
  CASCADE backbone) in `web.yaml`. (Complements the existing `llm4decompile` / `reverser-ai`
  / `ghidrassist` entries.)
- **Stripped-binary symbol recovery** (mined + verified from the
  `awesome-info-inferring-binary` index): `dirty` (var names + types baseline), `tygr`
  (GNN type inference), `varbert` (BERT variable names), `symgen` (LLM function names,
  NDSS'25) in `native.yaml`.
- **Agentic / model-level AI RE**: `oghidra` (LLNL local-Ollama agentic Ghidra loop),
  `r2ai`/`decai` (radare2 LLM reversing), `recopilot` (QI-ANXIN binary-expert LLM),
  `binaryai` (Tencent binary SCA platform), `blackfyre` (disassembler-agnostic ML-RE
  framework) in `native.yaml`. (The major MCP servers — ReVa, re-mcp, GhidraMCP,
  ida-pro-mcp, plus the `awesome-llm-reverse-engineering` index — were already catalogued.)
- **Target-coverage index** — `catalog/targets.yaml` (single source of truth for
  target-specific reversing assets) + `catalog/targets.py` (validator/renderer) →
  generated [`TARGETS.md`](TARGETS.md). One table answers "have we already reversed
  target X, and where is it?" The brain now consults it before reversing, and CI fails if
  `TARGETS.md` drifts from `targets.yaml`.
- `.github/` — community health files (`SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`), a CI workflow that runs `catalog/validate.py` on pull requests,
  and issue / pull-request templates.
- Bilingual README: `README.zh-CN.md` (Simplified Chinese, for reading convenience) with
  a language switcher; English `README.md` remains canonical.
- README **Case study** section surfacing the end-to-end DailyPay / Castle.io worked
  example.
- SVG banner (`docs/assets/banner.svg`) and Mermaid architecture / state-machine
  diagrams.

- **Artifact schemas** — `brain/artifacts/` now ships Draft-07 JSON Schemas for every
  phase artifact (`meta`, `fingerprint`, `plan`, `findings`), so the inter-phase contract
  is standardised instead of re-invented each run.
- `tools/fingerprint.py` — Phase 1 helper that scans an APK (+ splits) and emits a
  schema-conforming `fingerprint.json` (framework / packer / RASP / anti-bot detection,
  dex count, and an automatic `catalog/targets.yaml` coverage check).
- `tools/hermes_strings.py` — dump a React Native **Hermes** bundle's string table one
  per line (plain `strings` fails — Hermes concatenates the table); accepts an `.apk`
  directly and auto-uses the project venv's `hermes-dec`.
- `tools/workspace.py init <target>` — create the standard `00-intake … 07-verify`
  phase-dir skeleton + a `meta.json` stub, so phases never fail on a missing directory.

### Fixed
- **Every tool the pipeline needs is now auto-provisioned into the project** when missing —
  not just jadx. `tools/auto_reverse.py` resolves CLI tools through the project resolver
  (`.venv` → `tools/bin` → `PATH`) and auto-fetches missing ones via `fetch.py`
  (`jadx`, `ghidra`, `frida`, `mitmproxy`); `tools/hermes_strings.py` auto-fetches the
  `hermes-dec` library into `.venv`. Previously the driver only checked `PATH`, so a
  `fetch.py jadx`'d tool (landing in `tools/bin`) wasn't found. The driver now works on a
  fresh clone where the user has no RE tools installed — nothing touches the global env.
- CI (`validate.yml`) now also triggers on `README*`/`AGENTS.md`/`brain`/`tools`/`mcp` changes
  so `doccheck`/`smoketest`/`validate` actually run when the files they read change.
- `.gitignore` now explicitly ignores `.venv/` (previously relied on venv's own inner
  `.gitignore`).
- **capa / FLOSS native-triage expectations corrected** (`skills/native/capa-triage`,
  `brain/SKILL.md`, `brain/decision-tree.md`, `tools/registry.yaml`): FLOSS is **PE/shellcode
  only** and rejects Android `.so` (the skill wrongly claimed ELF support); capa from pip
  ships **without rules** and its default backend can't disassemble ARM64. Added a
  `capa-rules` registry entry (`fetch.py capa-rules`) and documented the working invocation
  (`capa -r tools/bin/capa-rules --backend ghidra`), with Ghidra as the faster default for
  Android `.so`.
- `tools/fetch.py` now provisions **any** `bundled: false` catalog/registry tool by
  falling back to its `install` command (pip installs are routed into the project venv),
  fulfilling the documented "fetch any catalog id on demand" promise — previously only a
  curated set of ~12 tools was fetchable.
- `tools/doctor.py` detects a **device-side** `frida-server` over adb instead of
  false-flagging it as missing (it is a phone-side binary, not a host tool).

### Changed
- `catalog/validate.py`: the "not provisionable" warning now fires only when a
  `bundled: false` tool has **neither** an `install` command **nor** a `source` URL
  (source-only tools are obtained manually and are no longer flagged).

## [0.1.0] — initial

### Added
- **The brain** (`brain/`) — evidence-driven orchestrator with an 8-phase state machine (numbered 0-7)
  (`fingerprint → plan → static → dynamic → native → synthesize → verify`),
  `decision-tree.md`, and framework playbooks.
- **The catalog** (`catalog/`) — 730+ routed capability entries across `android`, `web`,
  `native`, `windows`, `ios`, `frameworks`, and `mcp`, with `SCHEMA.md` and `validate.py`.
- **Bundled skills** (`skills/`) — domain skill libraries (android / ios / native / web /
  windows / common).
- **Tooling** (`tools/`) — `registry.yaml`, `doctor.py` (health check), `fetch.py`
  (zero-dependency on-demand provisioning), and adapters.
- **MCP** (`mcp/`) — `mcp.template.json` rendered into a machine-specific `.mcp.json` by
  `setup.ps1` / `setup.sh`.
- **Claude Code plugin** manifest (`.claude-plugin/marketplace.json`).
- First sanitized end-to-end case study: `cases/dailypay-castleio-android/`.

[Unreleased]: https://github.com/warterbili/AUTO_REVERSE/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/warterbili/AUTO_REVERSE/releases/tag/v0.1.0
