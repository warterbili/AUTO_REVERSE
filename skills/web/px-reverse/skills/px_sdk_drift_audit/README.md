# Skill: `px_sdk_drift_audit`

> Re-validate a generator after the SDK has potentially rotated.

## When to invoke

User says:

- "Did the SDK change?"
- "My generator is failing — check the SDK"
- "Audit drift"

## Procedure

Follow the SDK-upgrade methodology:

1. Re-lock the SDK
2. Compare SHA
3. Extract hQ from new SDK
4. Recapture 6 batches
5. Diff field maps
6. Re-run Stage 5 value-match
7. Update generator + templates
8. Re-validate 10/10
9. Log to `research/02_sdk_drift_longitudinal/timeline.md`

## Output

- Updated captured SDK (`source/main.min.js`)
- Updated per-site EV2 template (e.g. `<site>_ev2_template.json`)
- Updated per-site `state_key_map.json`
- Timeline entry
- Drift report (printed)

## Estimated time

30 minutes (most rolls) to 2 hours (new fields added).
