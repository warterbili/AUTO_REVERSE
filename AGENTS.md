# AGENTS.md — orientation for an AI/agent working in this repo

Read this first. It's the map and the operating rules — the things you **can't cheaply
infer by scanning** 750 catalog entries and 27 skills. Skim it, then dive into the specific
files it points you to. (Claude Code users: `brain/SKILL.md` is the registered skill; this
file is the tool-agnostic equivalent.)

## What this project is

**auto_reverse** is an AI-orchestrated framework for automated reverse engineering &
pentesting. You point it at one target (Android `APK`/package-id, iOS, Windows `PE`, native
`.so`, or a web URL) and drive it from fingerprint → analysis → a reproducible, **verified**
report.

It is **not** a monolithic tool. It is two layers:

- **`catalog/`** — a routing index of **750+ capabilities** (`*.yaml`, one file per domain).
  Each entry has a `when_to_use` line. You match the task against `when_to_use` to pick a
  tool. Entries are `bundled:true` (shipped in `skills/`) or `bundled:false` (fetched on
  demand via `tools/fetch.py <id>`).
- **`brain/`** — the orchestrator: a 7-phase state machine
  (`intake → fingerprint → plan → static → dynamic → native → synthesize → verify`).
  Each phase writes a JSON artifact; the next phase reads only that artifact. See
  `brain/SKILL.md` (full operating manual) and `brain/artifacts/` (the JSON schemas).

## Start here

| You want to… | Go to |
|---|---|
| Run a target end-to-end, headless | `python tools/auto_reverse.py <target>` → writes `workspace/<slug>/status.json` + `report.md`. **Read status.json** to see what's done vs awaiting you. |
| Understand the full workflow | `brain/SKILL.md` + `brain/decision-tree.md` + `brain/playbooks/` |
| Know what every tool does | `tools/README.md` |
| Check if a target was already reversed | `TARGETS.md` (generated from `catalog/targets.yaml`) |
| See a worked example | `cases/dailypay-castleio-android/` |
| Per-target working files | `workspace/<slug>/` (gitignored) — see `workspace/README.md` |

## Operating rules (non-negotiable — these are why we don't just "scan and go")

1. **Check coverage before reversing.** The moment you know the target (package id, host,
   cookie/header, SDK), grep `catalog/targets.yaml` / `TARGETS.md`. If it's covered (e.g.
   `tv.danmaku.bili` → `skills/android/bilibili-reverse`), **route to the existing asset** —
   don't re-reverse. Add new targets to `targets.yaml` when done.
2. **The catalog is a routing index, not tested integration.** An entry's `install`/`source`
   may be wrong. Before relying on a `bundled:false` tool, verify it (`tools/smoketest.py
   probe --id <id>`), and don't trust a tool's output without checking it.
3. **Verify, don't hallucinate.** A run isn't done until the **oracle** passes:
   `tools/oracle.py replay --from 06-synthesize/request.json --expect-status 200`. Never
   declare success on a plausible-looking algorithm — replay it.
4. **Prefer headless over GUI.** For native, use `analyzeHeadless` /
   `tools/ghidra_scripts/DumpDecomp.java` (the native phase auto-targets the right `.so`),
   not a GUI Ghidra+MCP that needs human clicks. Dynamic capture: `--auto-capture` drives the
   UI via `tools/ui_exercise.py`.
5. **Artifacts are the only interface between phases.** Read the previous phase's JSON; don't
   rely on conversation memory. Runs are resumable.
6. **English-only repo.** All catalog entries, skills, code, docs, commit messages in English
   (a translated `README.zh-CN.md` is the sole exception). Validate with
   `python catalog/validate.py` (also gates CI).
7. **Desensitize.** Never write real credentials/tokens/PII into reports or `cases/` — use
   placeholders. Honor [`SECURITY.md`](.github/SECURITY.md): authorized targets only; some calls (e.g. legality of a
   geo/compliance bypass) stay a human's decision, not the tool's.

## What's automated vs not (be honest about the boundary)

- 🟢 **Automated:** intake → fingerprint → plan → static → native (auto-targets the `.so`)
  → unattended dynamic capture (given a device + a `--flow`).
- 🟡 **One-shot human setup:** record a per-target UI `--flow` once; connect a rooted device.
- 🔴 **Stays human:** VM/heavily-obfuscated semantic judgement; authorization/legality calls.

## House rules for changes

- Validate before committing: `python catalog/validate.py && python tools/smoketest.py lint && python tools/doccheck.py` (all three gate CI).
- **When you add/change something, sync the related files** — see the upgrade matrix in
  [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md#keeping-things-in-sync--the-upgrade-matrix)
  (`doccheck.py` auto-enforces the count rows so docs can't silently drift).
- New catalog entry → concrete `when_to_use`, real `source`/`install` (probe it), unique id.
- New tool → flat `tools/<name>.py` CLI with a docstring usage block; add a row to
  `tools/README.md`. Don't deep-nest peer files.
- Target-specific asset (one app/SDK) → also add it to `catalog/targets.yaml`
  (`python catalog/targets.py --write`).
