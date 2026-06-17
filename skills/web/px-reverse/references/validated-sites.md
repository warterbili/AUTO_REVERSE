# Validated Sites Catalog

> **All concrete constants + the per-site b64 key mapping + deployment tier** for the 4 real
> sites that have been driven end-to-end.
> Purpose: a lookup table when reversing a **new site** — it makes clear "which parts are the
> universal algorithm and which parts differ per site."
>
> ⭐ **The most fatal portability bug**: the **base64 key names** of `state.*`/HMAC/counter in EV2
> are **different on every site**.
> Copying a template from one site to another = wrong key names = bot downgrade.
> **Every site must re-locate them with `find_state_keys_in_ev2.py`.**

## Four-site overview (3 tiers)

| Site | Tier | Cookie | POST chain | EV3 | /ns | hid | counter check | Transport requirement |
|---|---|---|---|---|---|---|---|---|
| **iFood** | lenient | `_px3` (TTL 330) | 2 (seq 0/1) | ✗ | ✓ fetched | ✗ | not checked | node TLS is fine |
| **Grubhub** | lenient | `_px2` (TTL 500) | 2 (seq 0/1) | ✗ | ✗ not fetched | ✗ | no field | node TLS is fine |
| **Total Wine** | strict | `_px2` (TTL 330) | 3 (seq 0/1/2) | ✓ mandatory | weak | ✓ | `PX12738==PX12739` | node TLS is fine |
| **Academy** | strict+ | `_px3` (TTL 330) | 3 (seq 0/1/2) | ✓ mandatory | ✓ **TLS-sensitive** | ✗ | **full pattern** (see Bug #20) | **must use a persistent Chrome-TLS session** |

## Constants (all measured live from the latest capture's POST body — never copied from old notes)

| | iFood | Grubhub | Total Wine | **Academy** |
|---|---|---|---|---|
| **AppID** | `PXO1GDTa7Q` | `PXO97ybH4J` ⭐(not `PXdRotaCw0`) | `PXFF0j69T5` | `PXqqxM841a` |
| **TAG (gt)** | `U0MmDhUmOnhXSw==` | `FmYgK1gdJEAP` | `CFQ7WU4xIS8MXA==` | `dgYGCzBjH3pyBg==` |
| **FT** | `401` | `359` ⭐(not `330`) | `401` | `405` |
| **OB XOR key** `ml(TAG)%128` | `100` | `91` | — | — |
| **Collector** | `collector-pxo1gdta7q.px-cloud.net/api/v2/collector` (third-party) | `sensor.grubhub.com/O97ybH4J/xhr/api/v2/collector` (first-party) | `www.totalwine.com/FF0j69T5/xhr/api/v2/collector` (first-party) | `collector-pxqqxm841a.px-cloud.net/api/v2/collector` (third-party) |
| **/ns host** | `tzm.px-cloud.net` | — (not fetched) | weak | `ift.px-cloud.net` |
| **SDK file** | `main.min.js` | `init.js` ⭐ | `main.min.js` (sha `9335db02`) | `init.js` (sha `50debea8`, 344410B) |
| **EV1 event-type `t`** | — | `YjIUOCdXHA8=` | `P28MJXoKARI=` | — |
| **EV2 event-type `t`** | — | `ViZgLBBGaB4=` | `JVEWW2MxG2k=` | — |

## EV2 `state.*` injection keys (**different per site — the #1 portability bug**)

| Semantic | iFood | Grubhub | Total Wine | Injection rule |
|---|---|---|---|---|
| `state.no` (timestamp) | `RTEwewNQMUg=` | `UT0ndxdcJUQ=` ⭐ | `YQ1SBydsVTQ=` | **`parseInt`** (Bug #1, never string) |
| `state.to` (big integer) | `FCAhKlJCIxk=` | `UBxmVhZ+Z2U=` | `fEgPAjoqCzE=` | string verbatim |
| `state.appId` | `Xi5rJBtKaB4=` | `CXV/P0wRfwU=` | `Bzd0fUJTcUc=` | string verbatim |

(Academy's state keys: `state.no→RBB0WgJxcGk=`, `state.to→ViZmLBBEYR8=`,
`state.appId→a1tbUS4/XWs=`, `state.echo→Slp6EA87eCY=`.)

## HMAC / MD5 fields (**inputs measured live per site, never copied**, Bug #18)

| Site | UUID-HMAC | VID-HMAC | PXSID-HMAC | MD5 |
|---|---|---|---|---|
| **iFood** | `M2MGKXUOBB8=`=HMAC(uuid,UA) | `FmYjbFAEJVg=`=HMAC(vid,UA) conditional | `BzdyfUFRd04=`=HMAC(pxsid,UA) conditional | — |
| **Grubhub** | `Pk5IBHsoTzQ=`=HMAC(uuid,UA) | — | — | also `cHwGdjYRB0A=`=HMAC(uuid+secondary,UA) |
| **Total Wine** | `Cho5UEx3PWY=`=HMAC(uuid,UA) | `Lx8cFWl9HCE=`=HMAC(**state.vid**,UA) ⭐ | `UiJhKBREYhs=`=HMAC(**state.pxsid**,UA) ⭐ | `EFwjFlU8JyU=`=**MD5(state.vid)** single arg ⭐ |
| **Academy** | `NABESnJtQ3w=`=HMAC(uuid,UA) | `cgICSDRgAXw=`=HMAC(vid,UA) | `Xi5uJBhIbhc=`=HMAC(pxsid,UA) | `QAxwRgVsd3U=`=MD5(vid) |

> ⚠️ Total Wine's VID/PXSID-HMAC use `state.vid`/`state.pxsid`, not `uuid+':a'/':b'` —
> copy them from iFood and you get trust=low. **Every site: measure across 6 batches with
> `find_hmac_field_sources.py`.**

## Counter dict (per-site key name + legal patterns)

| Site | b64 key | Pattern `(PX12739,PX12740)` | Checked? |
|---|---|---|---|
| iFood | `cyNGaTZBQVs=` | `(0,0)` | not checked |
| Grubhub | (no counter field) | — | — |
| Total Wine | `MDxDNnVeQgQ=` | `(N,0)` and `PX12738==PX12739` | checked |
| **Academy** | `AEwwBkUuMjQ=` | `(0,0)/(N,N)/(N,0)`, **`(0,N)` illegal** | **full-pattern check** (Bug #20) |

The structure is always `{PX12738:N (monotonic), PX12739:x, PX12740:y, PX12741:-1}`,
where `x/y` ∈ {0, N} and never vary independently.

## Wire char encoding (OB handler shape recognition, **differs per SDK version**)

| Site | Style | Chars | Example (state.no segment) |
|---|---|---|---|
| iFood | new | `0` (zero) + `l` (lowercase L) | `0lll000l\|<15-16 digits>` |
| Grubhub | old | `o` (lowercase) + `I` (uppercase i) | `oIIoIIIo\|<13 digits>` |
| Total Wine | — | `OlllOOll` (hid segment) | `OlllOOll\|<b64>=:<b64>\|true` |

**Do not hardcode handler line numbers** — match the OB segment by **argument count + shape**
via regex (see [`handler-table.md`](handler-table.md)).

## Cold/warm + /ns + Cookie strategy (differs per site)

| Dimension | iFood | Grubhub | Total Wine | Academy |
|---|---|---|---|---|
| EV1 field count | 14 (incl. /ns slot) | 12 (no /ns) | 13 | 13 |
| EV2 field count | ~204 | ~200 | ~220 | **203** (real Chrome; JSDOM gives 177) |
| EV3 field count | — | — | 11 | 11 |
| Cold-visit `pxhd` | `""` empty (also empty when warm) | — | — | — |
| /ns cold value | sm=`null` dur=`0` (EV1) | not fetched | — | sm=`null` dur=`0` (EV1) |
| EV3 cookie echo field | — | — | `OkpJAH8oTTA=`=`_px2` value | `MkJCCHcgRTk=`=`_px3` value |
| What the business layer guards | Data/GraphQL API | account auth | SRP/PDP HTML | product-page HTML |
| Proxy geo | `country-br` residential | US | US | **US residential, new IP per cookie** |

## Mandatory checklist before reversing a new site

1. **Collector domain** (first-party vs third-party) — capture real traffic, never assume `px-cloud.net`.
2. **EV2 `state.*` / HMAC / counter b64 keys** — different per site, re-locate with `find_state_keys_in_ev2.py`.
3. **Wire char style** (`0/l` vs `o/I`) — determines the OB-segment regex.
4. **Cookie name + TTL** — read from the OB#2 set_cookie segment, never assume `_px3`.
5. **Tier** (Stage 1.5) — `collector_post_count` 2 vs 3; 3 → strict, go find EV3/hid/counter/HMAC and measure them live.
6. **strict+ signals** (academy-class) — is the /ns token TLS-sensitive, must the template be real Chrome, is it IP-mint-sensitive (Bug #20-#23)?
7. **Business layer vs PX layer** validated separately — e.g. Grubhub's 463 OTP is account logic, not PX; device_id must be a fixed string.

For per-site details, see [`deployment-tiers.md`](deployment-tiers.md) and [`gotchas.md`](gotchas.md).
