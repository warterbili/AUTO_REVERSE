# Catalog Schema — master catalog spec for reversing skills/tools/mcps

This `catalog/` is the **core** of the project: an infinitely extensible inventory of reversing capabilities. The AI (see `brain/`) looks up "which one to invoke" here, based on the task and fingerprints.
**This project is about collecting, not integrating** — every entry is independent; users pick one or two as needed, with no requirement to install everything.

## Catalog files (split by domain; contributors edit the corresponding file)

- `catalog/android.yaml` — Android reversing
- `catalog/ios.yaml` — iOS reversing
- `catalog/native.yaml` — general native/binary (.so/PE/ELF)
- `catalog/windows.yaml` — Windows-specific
- `catalog/web.yaml` — Web / JS / anti-bot
- `catalog/mcp.yaml` — cross-domain MCP servers (let the AI drive tools directly)
- `catalog/frameworks.yaml` — framework-specific, e.g. Flutter / Unity / RN

## Entry fields

```yaml
- id: medusa                       # unique id (kebab-case)
  name: Medusa
  type: tool                       # skill | mcp | tool | script | agent | platform
  domain: android                  # android | ios | native | windows | web | framework
  capability: Modular Frida framework, 90+ modules (SSL unpin / behavior profiling / signature extraction)
  when_to_use: |                   # ★routing key★ the AI relies on this line to decide when to invoke it
    When you need batch / modular dynamic instrumentation, RASP bypass, or behavior profiling of a sample;
    better suited than objection for "combining multiple hook modules + reuse".
  source: https://github.com/Ch0pin/medusa
  install: "git clone + pip install -r requirements.txt"   # or pip/npm/release
  bundled: false                   # true = already shipped under this repo's skills/; false = fetch externally on demand
  platform: [android, ios]
  status: active                   # active | slowed | archived | commercial
  alt_to: [objection]              # optional: what it replaces/enhances
  note: bundles an MCP server (medusa_android_mcp.py)  # optional
```

Required: `id, name, type, domain, capability, when_to_use, source, bundled, status`.

## Meaning of status values
- `active` actively maintained ｜ `slowed` updates slowed but usable ｜ `archived` archived (note the modern replacement) ｜ `commercial` commercial / license required (no pirated copies provided)

## How to add a new entry (contributors)

1. Pick the `catalog/*.yaml` for the right domain and add an entry per the fields above.
2. For `bundled: true`, place the skill directory under `skills/<domain>/<id>/` (including SKILL.md).
   - **Note for `type: mcp` entries**: in `catalog/mcp.yaml`, `bundled: true` means "this project already ships the MCP config / backend" (see `mcp/mcp.template.json` → generated `.mcp.json`), NOT that there is a `skills/` directory. The two readings are deliberate: skill-type bundled = in `skills/`; mcp-type bundled = config-shipped.
3. For `bundled: false`, just register it — the AI fetches it on demand via `install` when needed (pip/npm into the project `.venv`, binaries into `tools/bin/`; see `tools/fetch.py`).
4. Run `python catalog/validate.py` to verify the fields are complete and ids are unique.

## How the AI uses this catalog (routing)
After `brain/SKILL.md` fingerprints the target → it selects candidates in the catalog by `domain` + `when_to_use` → if `bundled:false` and not present locally → `fetch` → invoke. **Only invoke the one or two needed for the task at hand; don't install everything.**
