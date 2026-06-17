# PX Deployment Strictness Reference (Deployment Tiers)

> New finding (2026-05-25): PX is not "one kind" of protection — it is **the same SDK with different server-side policies per customer**.
> The same generator works on lenient-tier sites and fails on strict-tier sites. This is not an algorithm bug; it means the additional checks of the strict tier were not covered.

## Why this document exists

The iFood/Grubhub generators historically passed 10/10, which meant they could actually drive business APIs. Applying that same experience to the totalwine generator, it issued cookies 10/10, but every cookie returned 403 against protected endpoints.
Repeatedly testing TLS / IP / proxies didn't help. The root cause turned out to be **unsatisfied server-side checks of a strict-tier deployment**.

To avoid hitting the same trap on the next new site, this document tiers PX deployments by "strictness" and cross-references the 4 sites already validated (including strict+ academy, see the dedicated section below).

## Two-tier overview (strict+ academy in the dedicated section below)

| Dimension | Lenient tier (iFood, Grubhub) | Strict tier (Total Wine) |
|---|---|---|
| **Collector POST chain length** | 2 POSTs (seq=0, 1) | **3 POSTs (seq=0, 1, 2)** |
| **Cookie issuance** | seq=1 response | seq=1 response |
| **Cookie immediately usable** | ✅ usable for business APIs as soon as received | ❌ **must send the seq=2 cookie-confirmation beacon before the edge accepts it** |
| **Backend HMAC field validation** | weak / not checked | **strong validation**: the server independently recomputes and compares against the client-reported value |
| **Counter synchronization constraint** | not checked | **checked**: `PX12738 == PX12739`, monotonically increasing across EVs |
| **Collector path** | third-party (`*.px-cloud.net`) | **first-party** (`/<appPrefix>/xhr/api/v2/collector`) |
| **EV2 field count** | ~200 | ~199 |
| **`state` contains `hid`** | ❌ | ✅ |
| **Rejection shape on failure** | 403 + captcha | **403 + PX bootstrap JSON** (short JSON, no captcha) |

## How to determine a new site's tier (early classification)

**Stage 1.5 (recommended to add right after capturing 6 batches in the main workflow):**

```bash
# 1. Check collector_post_count
jq '.collector_post_count' sample/{1..6}/meta.json
#   consistently 2 → lenient tier
#   consistently 3+ → strict tier (decode the 3rd POST body to confirm it contains a cookie field)

# 2. Check the collector URL
grep first_collector_url sample/*/meta.json
#   *.px-cloud.net → third-party, leans lenient
#   <appPrefix>/xhr/api/v2/collector → first-party deployment, **high probability of strict tier**

# 3. Check whether the 3rd POST returns a cookie
node scripts/decode_payload.js sample/1/request_3.txt > ev3.json
jq '.[0].d | keys[]' ev3.json | grep -c "OkpJAH8oTTA="
#   ≥1 → strict tier, must implement the EV3 cookie-confirmation beacon

# 4. Check whether EV2 contains a hid-shaped state field
# After decoding response_1, look for a "OlllOOll|<base64>=:<base64>|true" segment
```

**Use the classification result to decide the subsequent validation rigor:**
- Lenient tier → follow the skill's existing `validate-generator.md` Layer 3 (obtaining the cookie is enough)
- Strict tier → **must** follow Layer 3.5 (actually hit a PX-gated endpoint) + re-measure every HMAC field input using `recover-hmac-formulas.md`

## Validated cases

### Lenient tier #1: iFood
- AppID: `PXO1GDTa7Q`
- Collector: `https://collector-pxo1gdta7q.px-cloud.net/api/v2/collector`
- Deployment traits: 2 POSTs, third-party collector, `_px3` cookie
- Difficulty: passes once the algorithm is correct; the backend does not deeply inspect EV field semantics

### Lenient tier #2: Grubhub
- AppID: `PXO97ybH4J`
- Collector: `https://sensor.grubhub.com/O97ybH4J/xhr/api/v2/collector` (first-party but lenient)
- Deployment traits: 2 POSTs, first-party collector, `_px2` cookie
- Difficulty: passes once the algorithm is correct and the EV2 b64 key holding state.no is pinned down across 6 batches

### Strict tier #1: Total Wine
- AppID: `PXFF0j69T5`
- Collector: `https://www.totalwine.com/FF0j69T5/xhr/api/v2/collector`
- Deployment traits: 3 POSTs, first-party collector, `_px2` cookie, EV2 has hid state, counter synchronization constraint
- Difficulty: even after the algorithm is correct, there are **still 4 independent traps** (Bug #15-#18)

### Strict+ tier #2: Academy Sports (2026-06-13, the third tier) ⭐
- AppID: `PXqqxM841a`
- Collector: `https://collector-pxqqxm841a.px-cloud.net/api/v2/collector` (third-party)
- `/ns`: `https://ift.px-cloud.net/ns?c=<uuid>`; Cookie `_px3` (TTL 330); SDK sha `50debea8`
- Deployment traits: everything in the Total Wine tier (3 POSTs, EV3, hid, counter, strong HMAC validation), **plus three new checks + one transport/IP dimension**:
  1. **Counter full-pattern check** (Bug #20) — not just `PX12738==PX12739`; the sub-fields may only be `(0,0)/(N,N)/(N,0)`, and `(0,N)` is illegal.
  2. **The `/ns` token is TLS-fingerprinted** (Bug #21) — a token fetched over node TLS is short (432) and trust-downgraded; you must use real Chrome TLS (504).
  3. **A pure-math static template should preferably be captured from real Chrome CDP** (Bug #22) — the real capture's 203 fields are more complete and truer than the 177 a JSDOM dump gives (the safe default); but **JSDOM is not a trust ceiling**: node_bridge running the live SDK passes on a clean IP in practice (1.2MB of real data).
  4. **Transport must be a Chrome-TLS persistent session + is IP-reputation-sensitive** (Bug #23) — the whole chain (/ns+collector+edge) rides one curl_cffi chrome142 session; high-frequency minting from a single IP gets trust-downgraded. **This is the dominant factor in academy's pass rate.**
- Measured: **a fresh residential IP each time → 10/10**; the local IP after repeated minting → ~1/5 (IP reputation, not the algorithm).
- Difficulty: even after every field is correct (field-by-field diff passes), **trust is still determined by the transport + IP + counter legality at mint time**.

## Why the strict tier is harder

In the lenient tier, the backend only checks "is the PC reported by this session valid + is the EV2 field structure reasonable", and lets through anything above the score threshold.
In the strict tier, the backend additionally checks:

1. Does the client-reported HMAC equal the HMAC the server independently computes from the real inputs (state.vid / state.pxsid, etc.)?
2. Was the cookie echoed back (seq=2 beacon)?
3. Are the cross-event counters synchronized and monotonic?
4. Do the EV1/EV2/EV3 field sets strictly match what the SDK actually produces (no extras / no omissions / no cross-event reuse)?
5. Is the `hid` (device hardware id) in the state echoed back verbatim?

If any one of these fails → the cookie is issued but trust=low → the edge rejects it.

## Tier 3: strict+ (academy) — trust is also bound to "how you mint"

The Total Wine tier is all **server-side validation of EV content** (HMAC, counter, field set). academy goes beyond this,
binding the cookie's trust additionally to **the transport and environment authenticity at mint time** — even if the EV content
is correct field-by-field, it may still be low trust:

| New dimension | How strict+ (academy) checks it | Countermeasure |
|---|---|---|
| **Counter sub-field full pattern** | `(PX12739, PX12740)` may only be `(0,0)/(N,N)/(N,0)`; `(0,N)` is illegal (the Total Wine doc only covered `PX12738==PX12739`) | Use the real pattern matching the captured batch; cross-tabulate the sub-counters across 6 batches |
| **The `/ns` token's TLS fingerprint** | The `/ns` response's `sm` length varies with the client TLS (node 432 / Chrome 504-512) | `/ns` must ride the **same Chrome-impersonate session** as the collector |
| **Pure-math static template** | The 203 fields captured from real Chrome CDP are more complete and truer than the 177 a JSDOM dump gives | The pure-math template should **preferably be captured from real Chrome CDP** + rotate multiple fingerprints. ⚠️ JSDOM is **not** a ceiling — node_bridge running the live SDK passes on a clean IP in practice (1.2MB) |
| **Transport fingerprint** | Minting directly over node TLS → low trust, the gateway rejects | The whole chain rides a curl_cffi `chrome142` persistent session (closest to a real 149) |
| **IP mint reputation** | A single exit IP minting at high frequency → that IP (or even the proxy pool) is trust-downgraded | One fresh residential IP per cookie; "the browser can open the homepage" ≠ "minting from that IP is trusted" |

**To localize "where the wall is", use the 4-way matrix** (real browser/curl × real cookie/our cookie): the REAL cookie passes both ways;
a low-trust cookie passes only in the real browser and is rejected under curl → the problem is in the **cookie trust score** (not transport/IP).
Tools: `trust_matrix.py` (site-agnostic 4-way matrix), `session_server.py` (persistent Chrome-TLS sidecar), `diff_ev_field_by_field.py` (field-by-field).

> ⚠️ The key insight for strict+: **a low and jittery Layer 3.5 pass rate ≠ a wrong algorithm.** First confirm the EV with a field-by-field diff
> (static must be equal, dynamic must match shape + legal pattern), then use the 4-way matrix to distinguish cookie-trust vs transport/IP.
> The real reason academy was stuck at ~40% was a single illegal counter pattern (not a missing field).

Cross-references: counter full pattern (Bug #20), `/ns` TLS fingerprint (Bug #21), real-Chrome template (Bug #22), transport + IP trust (Bug #23),
plus cross-event consistency (Bug #19). See the end-to-end [`../playbooks/reverse-strict-plus.md`](../playbooks/reverse-strict-plus.md).

## Recommendations for future extension

When you encounter a new site (especially large US retail / liquor / banking / airline), classify the tier first per Stage 1.5.
If it is strict tier, prioritize finding:

- [ ] The EV3 cookie-echo field (Gotcha #16)
- [ ] Whether the `MDxDNnVeQgQ=`-style counter dictionary field has an equality constraint among PX12xxx subfields (Gotcha #17)
- [ ] The real inputs of all HMAC fields (Gotcha #18 / `recover-hmac-formulas.md`)
- [ ] Whether the state has extra non-standard fields such as `hid` (OlllOOll segment)

Write the tier-classification result at the top of your working-dir `<site>/log/RECON.md` so the next maintainer can tell at a glance which tier the site belongs to.
