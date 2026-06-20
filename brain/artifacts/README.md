# Artifact contract

Artifacts are the **only interface between phases** — each phase writes one JSON file into
`workspace/<target>/<NN-phase>/`, and the next phase reads only that file (never the model's
memory). The run is therefore interruptible and resumable.

This directory holds the **JSON Schemas** every artifact must satisfy, so the shape is
standardised instead of re-invented each run.

| Phase | File written | Schema |
|---|---|---|
| 0 Intake | `00-intake/meta.json` | [`meta.schema.json`](meta.schema.json) |
| 1 Fingerprint | `01-fingerprint/fingerprint.json` | [`fingerprint.schema.json`](fingerprint.schema.json) |
| 2 Plan | `02-plan/plan.json` | [`plan.schema.json`](plan.schema.json) |
| 3–5 Static / Dynamic / Native | `0N-<phase>/findings.json` | [`findings.schema.json`](findings.schema.json) |

The static/dynamic/native phases all share the one uniform `findings.schema.json`
(distinguished by the `phase` field) — see the **Artifact Contract** section of
[`../SKILL.md`](../SKILL.md).

### Validate an artifact

Schemas are Draft-07 JSON Schema. With `pip install jsonschema`:

```bash
python -c "import json,jsonschema,sys; jsonschema.validate(json.load(open(sys.argv[1])), json.load(open(sys.argv[2])))" \
    workspace/<target>/01-fingerprint/fingerprint.json brain/artifacts/fingerprint.schema.json
```

`tools/fingerprint.py <apk>` emits a `fingerprint.json` that already conforms.
