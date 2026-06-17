# px-reverse — PX SDK Reverse-Engineering AI Skill

> A PerimeterX SDK reverse-engineering capability pack for AI agents (Claude Code, etc.).
> Includes algorithm modules, CLI tools, references, and a gotchas list.

## Directory structure

```
px-reverse/
├── SKILL.md                  ← AI agent trigger + quick overview (read this first)
├── README.md                  ← this file
├── references/                ← knowledge layer (7 .md — "what is this")
│   ├── algorithm-chain.md     full formulas for the 5 core algorithms
│   ├── locate-by-pattern.md   ⭐ cross-version grep location manual
│   ├── handler-table.md       27-entry OB handler shape-matching table
│   ├── field-categories.md    EV2 field STATIC/DYNAMIC/CONDITIONAL classification
│   ├── gotchas.md             ⭐ list of 23 real-world gotchas
│   ├── deployment-tiers.md    PX lenient / strict / strict+ tier comparison
│   └── validated-sites.md     ⭐ 4-site constants + per-site b64 key map
├── playbooks/                 ← operation layer (11 .md — "how to do it")
│   ├── master-workflow.md       ⭐⭐⭐ end-to-end overview: cdp capture → 10/10 test (Stage 0-8)
│   ├── extract-constants.md            extract constants from captures (runtime)
│   ├── locate-all-constants.md   ⭐    uniformly locate the 5 constants from SDK source (methodology)
│   ├── identify-sdk-version.md         identify SDK version / drift detection
│   ├── reverse-algorithms.md     ⭐⭐  reverse the 9 algorithms out of obfuscated code (methodology)
│   ├── locate-functions.md       ⭐⭐  locate the 9 categories of key functional functions ⚠️ distinguish passive vs Bundle
│   ├── locate-field-sources.md   ⭐⭐  locate the value source of each EV field (5 methods)
│   ├── build-generator.md              from 6 batches of samples to a generator (8 steps)
│   ├── validate-generator.md           validation + failure-diagnosis decision tree
│   ├── recover-hmac-formulas.md  ⭐    5-step SOP to recover HMAC/MD5 field formulas
│   └── reverse-strict-plus.md    ⭐⭐  strict+ end-to-end (counter pattern + /ns TLS + clean IP + 4-way matrix)
├── revers/                    ← 9 bundled algorithm modules (require('../revers/...'))
└── scripts/                   ← CLI tools (18: 8 .js + 10 .py)

ℹ️ The 9 algorithm modules are bundled in [`./revers/`](revers/) (sibling to `scripts/`):
payload / pc / ob / sid / uuid / hash / memory / antitamper / ns. Scripts `require('../revers/...')` them.

    │
    │── Decoders ──
    ├── decode_payload.js      curl → EV JSON
    ├── decode_response.js     response → state + segments
    ├── extract_hQ.js          SDK → hQ dictionary
    │
    │── Cross-batch analysis ──
    ├── diff_samples.js        N batches → STATIC/DYNAMIC/CONDITIONAL (JS version)
    ├── diff_samples.py        same (Python version)
    ├── build_templates.js     ⭐ auto-generate STATIC field templates
    ├── identify_dynamic_semantics.py   DYNAMIC field semantic classification
    │
    │── state.* injection-position matching ──
    ├── find_state_keys_in_ev2.py        ⭐⭐⭐ Stage 5 key script
    │
    │── Field location ──
    ├── lookup_keys.js         b64 key → SDK location
    ├── probe_dynamic.js       DYNAMIC field location
    │
    │── Ours-generated vs real-captured comparison (for debugging) ──
    ├── diff_http_request.py    ⭐ HTTP request byte-level diff
    ├── compare_ev2_field_by_field.py   EV2 field-by-field comparison
    │
    │── Cross-version migration ──
    ├── map_keys.js            old SDK key → new SDK key mapping
    │
    │── End-to-end validation ──
    └── verify_batch.js         ⭐⭐ decode round-trip regression test
```

## How to use

### For an AI agent

Place the whole `px-reverse/` directory under Claude Code's `~/.claude/skills/` (or project-level
`.claude/skills/`); Claude Code auto-loads it when it sees the trigger keywords in `SKILL.md`.

### For humans

```bash
# Decode one capture
node scripts/decode_payload.js samples/1/request_1.txt > ev1.json

# Decode the OB response
node scripts/decode_response.js samples/1/response_1.json TAG > state.json

# Three-way classification
node scripts/diff_samples.js samples/{1..6}/decoded_payload_2.json

# Reuse the algorithms when writing a generator (from scripts/)
const { generatePayload } = require('../revers/payload');
const { generatePC } = require('../revers/pc');
```

## Companion resources

| What you want | Where |
|---|---|
| Algorithm modules | bundled in [`revers/`](revers/) |
| Capture tools | the companion CDP capture skill |
| Validated-sites catalog | [`references/validated-sites.md`](references/validated-sites.md) |

## Status

| Dimension | Status |
|---|---|
| Algorithm modules | ✅ all 9 verified by measurement |
| iFood generator | ✅ 10/10 (lenient) |
| Grubhub generator | ✅ 10/10 (lenient) |
| Total Wine generator | ✅ 10/10 (strict) |
| Academy generator | ✅ 10/10 (strict+, clean residential IPs) |
| Cross-version location manual | ✅ verified against multiple SDK versions |
| Gotchas | ✅ 23 (5 Bundle + strict #15-18 + strict+ #19-23) |
| Last validated | 2026-06-13 |

## A note to the user

This skill **is not a blog summary** —— it's distilled from a real **full closed-loop** campaign across
4 sites (iFood + Grubhub + Total Wine + Academy) × 6+ batches of samples each × repeated stability tests.
Every constant, field position, and field type comes from live captures, never from memory or stale docs.

**Across 3 years of observation, PX rotates its obfuscation frequently but has never changed the algorithms.**
Build the methodology on the algorithms (grep RFC-standard constants, protocol strings, browser API names),
and each new SDK won't force you to start over — you only need 30 minutes to re-locate the key positions,
and all the remaining code can be reused.

For the detailed methodology, see the playbooks in [`playbooks/`](playbooks/) (especially `master-workflow.md` and `reverse-strict-plus.md`).
