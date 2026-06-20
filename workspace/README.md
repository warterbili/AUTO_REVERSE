# `workspace/` — the reversing workspace

This is the working area for every reversing run. **One subdirectory per target**, each
holding the phase artifacts and any temporary files. Everything here is **gitignored**
(except this README and `.gitkeep`) — real targets, pulled APKs, captured traffic, and
decompiler output never get committed; only the sanitized writeups under `cases/` do.

## Layout

```
workspace/
└── <target-slug>/                 # created by: python tools/workspace.py init <target>
    ├── 00-intake/                 # the acquired target + meta.json
    │   ├── meta.json              #   (conforms to brain/artifacts/meta.schema.json)
    │   └── base.apk, split_*.apk  #   the pulled/given binary
    ├── 01-fingerprint/            # fingerprint.json (framework / packer / protections / coverage)
    ├── 02-plan/                   # plan.json (chosen playbook + ordered tasks)
    ├── 03-static/                 # findings.json + decompiled/extracted artifacts (strings.txt, ...)
    ├── 04-dynamic/                # findings.json + captured traffic (needs a device/browser)
    ├── 05-native/                 # findings.json + decomp.c, ghidra-proj/ (.so deep-dive)
    ├── 06-synthesize/             # the recovered algorithm / reproducer
    ├── 07-verify/                 # oracle results (replayed request → accepted?)
    ├── status.json                # machine-readable run state (what's done/blocked/needs-human)
    └── report.md                  # human-readable summary
```

## How it's driven

- **Autonomous, from zero:** `python tools/auto_reverse.py <apk|package-id|url>` runs the
  whole pipeline headlessly, writing the artifacts above and a `status.json` + `report.md`.
  It is **resumable** — re-running skips phases whose artifacts already exist.
- **Per-phase helpers** (callable on their own):
  `tools/workspace.py` (scaffold), `tools/fingerprint.py` (Phase 1),
  `tools/hermes_strings.py` (RN static), `tools/oracle.py` (Phase 7 verify).
- **Artifacts are the only interface between phases** (see `brain/artifacts/`), so a run is
  interruptible and another tool/agent can pick up from the last artifact.

## Hygiene

- Desensitize anything promoted to `cases/`: redact keys/tokens/PII and third-party traffic.
- Safe to delete any `<target-slug>/` dir to reclaim space; nothing here is source-of-truth.
