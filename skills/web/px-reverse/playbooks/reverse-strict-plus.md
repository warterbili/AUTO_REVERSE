# Playbook — End-to-End Reversing of a strict+ Site (strict+ tier)

> When to use: Stage 1.5 classification shows it is **strict+** (collector 3-POST + the full strict tier,
> yet the cookie content looks flawless and is still rejected by the gateway).
> The key insight for strict+: **every field matching ≠ passing. Trust is also determined by the
> authenticity of the mint transport + the authenticity of the environment + the IP reputation.**
> First sample: academy.com (see [`deployment-tiers.md`](../references/deployment-tiers.md) tier 3, gotchas #19-#23).

Duration: once the lenient/strict foundations are solid, strict+ adds roughly 1-3 h. Every step maps to a tool or a gotcha.

---

## 0. Classify (Stage 1.5) — confirm it is strict+

For lenient/strict classification, see [`deployment-tiers.md`](../references/deployment-tiers.md). **The incremental signal of strict+**:
- field-by-field diff **fully passes** (static equal, dynamic shapes match), the collector chain is all 200, the cookie is issued normally,
- **but the PX-gated endpoint is still challenged and the pass rate is jittery** (not a stable 0 — it drifts 30-60%).

→ Stop staring at single fields. The problem is one of four things: **counter legal pattern / transport TLS / template authenticity / IP reputation.**

## 1. Capture — use real Chrome CDP for pure-math static templates ⭐

```bash
python scripts/capture_via_cdp_<site>.py 6     # real Chrome CDP, 6 batches, record sdk_sha256
```
**Safe default for pure math (Bug #22)**: when writing **pure math**, the static EV template should
**preferably be captured from real Chrome CDP** (203 fields, more complete and with truer sensor values
than the 177 a JSDOM dump gives). Capture several batches → **rotate multiple fingerprints** to avoid the
same fingerprint being correlated and downgraded.
⚠️ **But JSDOM is not a trust ceiling**: node_bridge running the live SDK passes academy on a clean residential
IP in practice (pulled 1.2MB of real product data) — it is both a **reversing oracle** and a **maintenance-free
production fallback** (it runs the live SDK, so it auto-adapts when the SDK rotates). The real determinant of the
pass rate is **counter + TLS + IP** (Bug #23).

## 2. Field-by-field diff — static equal / dynamic shape matches ⭐

```bash
python scripts/diff_ev_field_by_field.py our_ev2.json sample/2/decoded_payload_2.json override_keys.txt
```
- **STATIC MISMATCH** = you corrupted a template field → fix it.
- **TYPE MISMATCH** = number/string error (Gotcha #1, e.g. state.no needs parseInt) → fix it.
- **SHAPE DIFF** = a dynamic field's source is wrong (int width / str length / float-vs-int / dict pattern) → go reverse it in the SDK.

## 3. Classify hardcode vs live
[`field-categories.md`](../references/field-categories.md) + `diff_samples` across 6 batches: invariant across batches = hardcode (lock the template),
varies = live (go reverse it).

## 4. Hardcode: lock the template + mind the types
Deep-clone the real-Chrome template, override only the live fields. **Types**: any numeric string decoded from OB, when referenced into an EV, always `parseInt` it (Gotcha #1).

## 5. Live: reverse the SDK's real generation point ⭐
[`locate-field-sources.md`](locate-field-sources.md): for each live b64 key, grep the literal
`t["<b64key>"]=<expr>` in the SDK and trace `<expr>` back to its source. The key categories to reverse on strict+:
- **HMAC/MD5**: inputs measured live per site, never copied (Bug #18, e.g. totalwine uses state.vid, not uuid+:a).
- **counter dict**: see step 6 (the easiest to trip on).
- **timestamp dual-clock**: `performance.now()` (since navigation, a large value) vs the `Date.getTime()` diff (a small value) — do not mix them; /ns duration is a **float**.
- **things you cannot reverse out of the CFF/VM** (e.g. some entropy metric): confirm the **backend does not recompute** it (environment / timing class) → just take a real captured range value.

## 6. ⭐ Counter legal pattern (Bug #20) — the most hidden strict+ trap
counter dict `{PX12738:N, PX12739:x, PX12740:y, PX12741:-1}`, with `x/y ∈ {0, N}` and **never independent**.
**Cross-tabulate across 6 batches** and list every `(x,y)` combination that ever appeared = the legal pattern space.
A real browser typically produces only the three: `(0,0)/(N,N)/(N,0)`, and **`(0,N)` is illegal**.
The generator should use the real pattern that matches the batch it captured.
> The real reason academy stalled at ~40% was that it wrongly emitted `(0,N)`; fixing it → 10/10.

## 7. Cross-event consistency (Bug #19)
```bash
python scripts/cross_event_consistency.py samples         # real captures → extract rules
python scripts/cross_event_consistency.py samples/_our_ev # ours, line-by-line compare
```
CONSTANT fields (page-load ts/uuid/platform) must be **constant** across the three events; MONOTONIC (perf/counter/now-ts) must **increase**.

## 8. ⭐ /ns over real Chrome TLS (Bug #21)
The `sm` length returned by `/ns?c=<uuid>` varies with the client TLS (node 432 / Chrome 504-512).
Fetching it with node = a token that exposes "claims Chrome but is actually node." **/ns must ride the same real Chrome session as the collector.**

## 9. ⭐ Whole-chain transport: a chrome142 persistent session (Bug #22/#23)
The whole chain — **/ns + the 3 collector POSTs + edge** — rides **one** curl_cffi `chrome142` (closest to a real 149)
persistent session + a homepage warmup to obtain the akamai cookie. Unify it with the sidecar:
```bash
PX_IMPERSONATE=chrome142 PX_PROXY=<residential> python scripts/session_server.py
# the generator forwards its /ns and every collector POST to 127.0.0.1:8765 (USE_SESSION mode)
```
Minting directly over node TLS → low trust.

## 10. ⭐ Clean IP, one per cookie (Bug #23)
strict+ is sensitive to the reputation of the exit IP at mint time: high-frequency minting from a single IP →
that IP (or even the whole proxy pool) gets downgraded.
**Layer 3.5 must be tested on a clean residential IP, with a new IP per cookie.** "The browser can open the homepage" ≠ "minting from that IP is trusted."

## 11. ⭐ When stuck, localize with the 4-way trust matrix (don't guess-and-patch)
```bash
HOME_URL=https://site/ GATED=https://site/gated COOKIE=_px3 OUR_COOKIE="<ours>" \
  python scripts/trust_matrix.py
```
- REAL cookie passes both, OUR cookie fails both → **cookie content** problem, back to step 2 diff.
- OUR cookie passes in real browser / fails under curl → **borderline trust**, check steps 6/8/9.
- REAL cookie also starts failing under curl → **the IP / proxy pool is degraded from testing**, switch IP, don't mistake it for an algorithm regression.

---

## Acceptance
- `diff_ev_field_by_field` 0 problems + `cross_event_consistency` all match + counter legal pattern.
- On a clean residential IP (a new one each time), run Layer 3.5 (actually hit the PX-gated endpoint) ≥10 times → no captcha redirect = pass.

Full real case: academy.com strict+, **10/10** on fresh residential IPs. The methodology generalizes to any strict+ site.
