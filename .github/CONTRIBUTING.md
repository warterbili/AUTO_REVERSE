# Contributing to auto_reverse

Thanks for helping grow auto_reverse! The project is designed so that **most
contributions are data, not code** — you add a capability by appending one entry to a
catalog file, and the brain picks it up automatically.

Please read this guide before opening a pull request.

## Language policy

> [!IMPORTANT]
> auto_reverse is an **English-only international project**. Write all catalog entries,
> skills, documentation, code comments, and commit messages in **English**. A translated
> README (e.g. `README.zh-CN.md`) is allowed for reading convenience, but the canonical
> docs and every in-repo artifact stay English.

## Ways to contribute

From simplest to most involved. The full reference lives in the README's
[Extending](../README.md#-extending) section; this is the contributor checklist.

### 1. Register an on-demand capability — the common case

Append an entry to the matching `catalog/*.yaml` (`android`, `web`, `native`,
`windows`, `ios`, `frameworks`, or `mcp`). The single most important field is
**`when_to_use`** — it is how the brain routes. Make it concrete: name the situation,
the target type, and when to prefer this over alternatives.

- Required fields and the full schema: [`catalog/SCHEMA.md`](../catalog/SCHEMA.md).
- For `bundled: false` tools, provide either an `install` command **or** a `source`
  URL so the capability is provisionable.

### 2. Bundle a skill in-repo (`bundled: true`)

If your capability is a reusable **workflow/methodology**, add
`skills/<domain>/<id>/SKILL.md` with YAML frontmatter, then a catalog entry with
`type: skill` and `bundled: true`.

Rule of thumb: **a skill encodes *how* to do something**; **the brain decides *when and
why*.** Don't put orchestration logic in a skill.

> [!IMPORTANT]
> If the skill/script targets a **specific app or SDK** (e.g. a particular site's anti-bot,
> one app's request signing), also add it to the target-coverage index so it is never
> reversed twice: append an entry to [`catalog/targets.yaml`](../catalog/targets.yaml) and run
> `python catalog/targets.py --write` to regenerate [`TARGETS.md`](../TARGETS.md). CI fails if
> the two drift out of sync.

### 3. Register an MCP server

Add it to `catalog/mcp.yaml`, and if it should be wired up by `setup`, add a server
block to `mcp/mcp.template.json` using the `${PYTHON}` / `${TOOLS_ROOT}` placeholders.

### 4. Add a tool to the install registry

Add an entry to `tools/registry.yaml` with its `install`, `url`, and `check` command so
`doctor.py` and `fetch.py` both know about it.

## Before you open a PR

```bash
python catalog/validate.py     # must pass: required fields + globally unique ids
```

CI runs this on every pull request that touches `catalog/`. PRs that fail validation
will not be merged.

Checklist:

- [ ] `python catalog/validate.py` passes locally.
- [ ] New `id` is unique and kebab-case.
- [ ] `when_to_use` is specific (situation + target type + when to prefer it).
- [ ] `bundled: false` entries have an `install` command or a `source` URL.
- [ ] Everything is written in English.
- [ ] No real credentials, tokens, private keys, or PII anywhere in the diff.

## Keeping things in sync — the upgrade matrix

So an upgrade never leaves a doc stale. **When you change the thing in the left column,
also touch the files / run the commands on the right.** The "numbers" rows are enforced
automatically by `tools/doccheck.py` (CI fails on a false floor) — the rest is your checklist.

| When you add / change … | Also update | Run |
|---|---|---|
| **A catalog entry** (`tool`/`script`/`mcp`/`agent`) | — (the brain picks it up automatically) | `python catalog/validate.py` · `python tools/smoketest.py probe --id <id>` (verify source/install is real) |
| …that is **target-specific** (one app/SDK) | `catalog/targets.yaml` | `python catalog/targets.py --write` (regenerates `TARGETS.md`) |
| **A bundled skill** (`skills/<domain>/<id>/SKILL.md`) | a catalog entry (`type: skill`, `bundled: true`); the "**N bundled skills**" count in `README.md` + `README.zh-CN.md` | `python tools/doccheck.py` (skills count is exact) |
| **An MCP server** | `catalog/mcp.yaml`; `mcp/mcp.template.json` (if `setup` should wire it) | re-run `./setup.ps1` / `./setup.sh` → regenerates `.mcp.json` |
| **A new tool** (`tools/<name>.py`) | `tools/README.md` (the index table); `README.md` layout if prominent; `brain/SKILL.md` if it's part of the pipeline | `python -m py_compile tools/<name>.py` |
| **A fetchable external tool** | `tools/registry.yaml` (+ `tools/_toolspec.py` if `fetch.py`/`doctor.py` must know it) | `python tools/doctor.py` |
| **A playbook** (`brain/playbooks/<x>.md`) | reference it from `brain/decision-tree.md` + the Phase-1 matrix in `brain/SKILL.md` | — |
| **A case** (`cases/<slug>/`) | the README **Case study** section if it's the flagship; `targets.yaml` status → `in-repo+case` | `python catalog/targets.py --write` |
| **A phase artifact's shape** | `brain/artifacts/<phase>.schema.json`; the tool that emits it (`fingerprint.py` / `auto_reverse.py`); the Artifact Contract in `brain/SKILL.md` | validate a sample against the schema |
| **Enough entries to shift a domain total** | the catalog **badge** + headline count + per-domain table in `README.md`/`README.zh-CN.md`; the `(N+ entries)` in `brain/SKILL.md`; `AGENTS.md` | `python tools/doccheck.py` (catches false/stale floors) |

> Before every PR: `python catalog/validate.py && python tools/smoketest.py lint && python tools/doccheck.py`
> (all three gate CI). `doccheck` is what stops the kind of `640+`/`125+` count drift that
> otherwise creeps in unnoticed.

## Contributing a case study

Worked, end-to-end examples are some of the most valuable contributions. Put them under
`cases/<slug>/` with the phase artifacts (`fingerprint.json`, `static-findings.json`,
`dynamic-findings.json`, `report.md`, …). **Desensitize**: redact pk/keys/tokens and any
captured third-party traffic.

## Commit messages

Use clear, conventional-style prefixes where natural (`feat(catalog): …`,
`fix(brain): …`, `docs: …`, `chore: …`). Keep them in English and descriptive.

## Code of conduct

By participating you agree to uphold the
[Code of Conduct](CODE_OF_CONDUCT.md). Be respectful and constructive.
