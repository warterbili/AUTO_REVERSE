---
name: node-bridge-build
description: Build an "environment-patching" fallback bridge for anti-bot SDKs (e.g. PerimeterX / Akamai / similar vendors) using jsdom + 11 env-patching modules + a Python curl_cffi coordinator, without relying on a real browser. Trigger scenarios: (1) a pure-algorithm generator temporarily breaks because the SDK was upgraded and you need a Plan B firefight; (2) a new-site spike — get something working in 30 minutes, then decide whether a pure-algorithm approach is worth it; (3) high-bar endpoints (such as the iFood feed) where the pure-algorithm score is not good enough; (4) adapting the existing ifood/ template to a new site (Grubhub / Walmart / Doordash, etc.). Trigger keywords: node bridge env patching / jsdom fake browser / PX SDK fallback / SDK upgrade emergency / build a bridge for <site> / env-patching template adaptation.
---

# Skill: Build a Node Bridge Environment Patch

> 🔝 **Fallback / upgrade path**: [**sdenv** — https://github.com/pysunday/sdenv](https://github.com/pysunday/sdenv) (718⭐, jsdom fork + plugin, the public ceiling for environment patching)
> When to switch to sdenv: see [`methodology.md §7`](methodology.md#7-when-to-upgrade-to-sdenv).

## User trigger phrases

- "Build a node bridge fallback for \<site\>"
- "The pure-algorithm approach for \<site\> stopped working, put together a jsdom env patch"
- "Adapt the ifood bridge to \<new_site\>"
- "Set up a Plan B for \<site\>"
- "The PX SDK was upgraded, the pure-algorithm approach is dead for now, build me a temporary bridge"

---

## What you (the AI) must deliver

```
node_bridge/<site>/
├── perimeterx/
│   └── <sdk_file>.js              ← the locked target SDK
├── px-node-env/
│   ├── env/                       ← 11 JSDOM env-patching modules (site-specialized)
│   └── ...
├── px_node_bridge.js              ← IPC bridge (adapted from the ifood template SDK path)
├── px_cookie_generator.py         ← Python coordinator (curl_cffi chrome131)
├── package.json
└── README.md                      ← the actual working commands for this site + journal
```

**Plus**: a verified live run output (target cookie obtained + business API 200 + a complete journal committed to stample/live_validation/journal/).

---

## Prerequisite skill dependencies (must read) ⭐

This skill is **not self-contained**. The node bridge = **an organic synthesis of 3 upstream skills**. Read these 3 first:

| Skill | Role in this workflow | Repo-relative path |
|---|---|---|
| **`cdp-browser`** | Upstream — dump fingerprint values from a real Chrome | `~/projects/Sourcing-AI-Skills/cdp-browser/` |
| **`jni-env-patching`** | Methodology — the 4-step "inspect the real environment first, then supply reasonable values" method | `~/projects/Sourcing-AI-Skills/jni-env-patching/` |
| **`curl_cffi_integrate_scrapy_performance`** | Network layer — chrome131 TLS impersonation | `~/projects/Sourcing-AI-Skills/curl_cffi_integrate_scrapy_performance/` |

For the **full synthesis diagram**, see [`methodology.md §0`](methodology.md#0-three-skill-synthesis-diagram).

---

## Workflow overview

| Phase | Content | Effort | Details |
|---|---|---|---|
| **Analyze** | Research the target site / lock the SDK / analyze the PX endpoints | 30 min - 1 h | `methodology.md §1-3` |
| **Implement** | Copy the ifood template → change path constants → dump real Chrome fingerprints → write env/ | 4 - 8 h | `new_site_guide.md` 9 steps |
| **Validate** | Get it working → call the real business API → write the journal | 30 min - 1 h | `new_site_guide.md` step 9 + `stample/live_validation/` |

---

## Existing reference material

| Resource | Path | Purpose |
|---|---|---|
| The complete working iFood bridge | `node_bridge/ifood/` | **Copy directly as a template** |
| iFood working log + full request/response | `stample/live_validation/journal/2026-05-21.md` | See what real output looks like |
| Methodology | `node_bridge/skill/methodology.md` | Required reading |
| Hands-on tutorial | `node_bridge/skill/new_site_guide.md` | 9-step walkthrough |
| sdenv (upgrade fallback) | https://github.com/pysunday/sdenv | Use to upgrade when this bridge is not enough |

---

## The three-layer fallback decision (which layer this skill sits at)

```
Layer 1: Pure algorithm (revers/ + stample/<site>/px_cookie/) — primary recommendation
   ↓ when it stops working
Layer 2: Our node_bridge (what this skill teaches)  ← you are at this layer
   ↓ when it still does not work (hitting typeof document.all / V8-level Proxy detection)
Layer 3: sdenv (jsdom fork + plugin) — fallback
```

For details, see [`methodology.md §"When to upgrade to sdenv"`](methodology.md#7-when-to-upgrade-to-sdenv).

---

## Things not to do

- ❌ **Do not use `generate_px.js` directly** — it is a standalone debug version left over from sourcing-cracked, and Node's default TLS will be detected by PX. You **must** go through the Python coordinator (`px_cookie_generator.py`).
- ❌ **Do not hardcode credentials in demo code** — proxy user/pass and account credentials all go through env vars (see `stample/grub/px_cookie/business_api_demo.js`).
- ❌ **Do not add `node_modules/` to git** — use `npm install` (package.json already records it).
- ❌ **Do not try to mock every browser API** — it is impossible and unnecessary. Following the jni-env-patching 4-step method, **only patch what the SDK actually reads**.

---

## Quick sanity check (30 seconds before starting)

```bash
# 1. Confirm the target site has a locked SDK
ls stample/<site>/source/

# 2. Confirm the ifood template runs (prerequisite)
cd node_bridge/ifood
ls perimeterx/main.min.js
python -c "import curl_cffi; print('OK')"

# 3. Confirm the cdp-browser skill is available
which python && python -c "import websockets; print('OK')"

# All OK → start on new_site_guide.md
```

---

*Skill date 2026-05-22 · iFood _px3 verified working*
