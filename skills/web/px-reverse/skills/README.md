# AI Skill Manifests

> The 4 skills an AI agent can invoke — the user-intent entry point (vs `../playbooks/`, which are the "how to do it" operation manuals).

---

## The 4 Skills

| Skill | User trigger phrase | Input | Effort |
|---|---|---|---|
| [`px_capture`](px_capture/README.md) | "capture N batches of fresh samples" / "rebuild templates" | site_name + target_url + batch_count | 30 min |
| [`px_decode`](px_decode/README.md) | "decode batch N" / "what's in this payload" | batch_dir + platform | 5 min |
| [`px_port_to_new_platform`](px_port_to_new_platform/README.md) | "port to `<sitename>`" / "add new site" | site_name + target_url + business_api | 4-15 h |
| [`px_sdk_drift_audit`](px_sdk_drift_audit/README.md) | "did the SDK change?" / "audit drift" | site_name | 30 min - 2 h |

---

## The difference between Skill and Playbook

| Type | Location | Perspective | Example |
|---|---|---|---|
| **Skill** | this skill's `skills/` | AI agent invocation entry (user intent) | `px_capture` → "I want to capture samples" |
| **Playbook** | [`../playbooks/`](../playbooks/) | Engineering step manual (how to do it) | `master-workflow.md` → "how to walk the 7 stages" |

Each skill internally references one or more playbooks.

---

## How to invoke

In Claude Code / Cursor:

```
@skills/px_capture/README.md
help me capture 6 batches of ifood samples
```

Or just say:

```
@SKILL.md
help me reverse-engineer PerimeterX on example.com
```

`SKILL.md` is the top-level skill entry; it auto-routes to the appropriate one of the 4 sub-skills.

---

## Where things live in this skill

| Component | Location |
|---|---|
| Decode / analysis / generator scripts | `scripts/` |
| Generated per-site cookie generator | your project's per-site generator (e.g. `ifood_px3.js`) |
| Capture + SDK download | `../cdp-browser/scripts/` |
| Methodology / algorithm details | `references/algorithm-chain.md` |
| Gotchas | `references/gotchas.md` |
| Captured SDK | `source/main.min.js` |
| Capture batches | `samples/N/` |
