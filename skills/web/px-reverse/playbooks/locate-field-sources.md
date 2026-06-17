# Playbook: Locating the Value Source of EV Fields

> EV2 has ~204 fields, and each field's value comes from **some function /
> variable / API call** in the SDK. To write a generator you must know **where
> each field's value originates**.
>
> This playbook teaches you to go from "I see an EV2 field `XXX=`" to "I found
> where it is assigned in the SDK."
>
> Estimated time: **30 minutes to 1 hour** (depending on how many fields you need
> to locate).

---

## Core Mental Model

EV2 field value sources fall into 5 categories:

```
                                                coverage   difficulty
┌──────────────────────────────────────┐
│ 1. Direct browser native API read     │  ~40%   ⭐ easiest
│    (navigator.platform, screen.width...)│
├──────────────────────────────────────┤
│ 2. JS expression / literal            │  ~20%   ⭐⭐
│    (fixed true/false/number)          │
├──────────────────────────────────────┤
│ 3. PX algorithm function call         │  ~15%   ⭐⭐⭐
│    (HMAC, ml(), Date.now(), uuidV1())  │
├──────────────────────────────────────┤
│ 4. state.* injection (from OB#1)      │   ~5%   ⭐⭐⭐⭐
│    (parseInt(state.no) etc.)           │
├──────────────────────────────────────┤
│ 5. Cross-sample diff inference        │   ~20%  ⭐⭐⭐⭐ fallback
└──────────────────────────────────────┘
```

Each field is located by one of these methods. Master the 5 methods plus the
decision tree and you can find the source of any field.

---

## The 5 Locating Methods

### Method A: grep the browser API name (covers 40% — easiest)

**Applies when**: the value looks like a browser property (`"Win32"`, `1920`,
`"webkit"`, `"visible"`, etc.).

**Key insight**: the obfuscator **cannot rename** native API names like
`navigator.platform` — renaming them would break the call.

```bash
SDK="main.min.js"

# list common browser API literals -> their corresponding EV2 fields
grep -boE 'navigator\.platform'             $SDK   # -> "Win32"/"MacIntel"/...
grep -boE 'navigator\.userAgent'            $SDK   # -> full UA string
grep -boE 'navigator\.language'             $SDK   # -> "zh-CN" etc.
grep -boE 'navigator\.languages'            $SDK   # -> ["en-US","zh-CN"...]
grep -boE 'navigator\.vendor'               $SDK   # -> "Google Inc."
grep -boE 'navigator\.connection'           $SDK   # -> connection object
grep -boE 'screen\.width\|screen\['         $SDK   # -> 1920/2560/...
grep -boE 'screen\.height'                  $SDK   # -> 1080/...
grep -boE 'performance\.memory'             $SDK   # -> memory object
grep -boE 'performance\.now\b'              $SDK   # -> float
grep -boE 'document\.visibilityState'       $SDK   # -> "visible"
grep -boE 'location\.protocol'              $SDK   # -> "https:"
grep -boE 'location\.href'                  $SDK   # -> current URL
grep -boE 'new Date\(\)\.toString\b'        $SDK   # -> "Tue May 19 ..."
grep -boE 'getTimezoneOffset'               $SDK   # -> timezone number
```

**Usage**: when you see field `d['XXX=']` with value `"Win32"` in captured
traffic, you immediately know **it comes from `navigator.platform`**.

### Method B: grep the plaintext b64 key (covers 30%)

**Applies when**: the SDK does not reference keys indirectly via the hQ dictionary
but writes the plaintext key directly in the source.

```bash
# suppose you have the b64 key "RTEwewNQMUg=" from EV2
grep -boE '"RTEwewNQMUg="' sdk.js
# -> hit byte offset + surrounding code
```

After the hit, read the context:

```js
"RTEwewNQMUg=": parseInt(t.no),   // <- assigned the parseInt of state.no
// or
"RTEwewNQMUg=": Date.now(),       // <- assigned Date.now()
```

**Note**: when you grep a b64 key, include the **quotes and equals sign**,
otherwise the `+/` inside base64 will cause false matches.

### Method C: hQ dictionary reverse-lookup (covers ~50%, complements Method B)

**Applies when**: the SDK references b64 keys indirectly via `hQ(N)`.

```bash
# 1. first extract the hQ dictionary
node ../scripts/extract_hQ.js sdk.js > hQ_map.json

# 2. reverse-lookup the b64 key -> N
node -e "
const map = require('./hQ_map.json');
const target = 'RTEwewNQMUg=';
const N = Object.entries(map).find(([k,v]) => v === target)?.[0];
console.log('hQ index:', N);
"
# -> suppose it prints hQ index: 247

# 3. find the hQ(247) call in the SDK
grep -boE 'hQ\(\s*247\s*\)' sdk.js
```

After the hit, read how `hQ(247)` is used (what it is assigned to / used as a key
for).

### Method D: algorithm magic-constant location (covers PC/HMAC/hash fields)

**Applies when**: the value looks like a hash (32 hex = MD5, 64 hex = SHA-256),
UUID, or timestamp.

```bash
# EV2 field value is 32 hex chars -> HMAC-MD5
# find the code block around the HMAC call in the SDK
grep -B2 -A5 "909522486" sdk.js   # near the HMAC ipad constant

# 13-digit ms timestamp -> Date.now() or state.no
grep -nE 'Date\.now\(\)' sdk.js

# UUID -> uuidV1() or state.{pxsid,vid,cts}
grep -nE 'uuid|122192928e5' sdk.js
```

### Method E: cross-sample diff inference (fallback, covers the remainder)

**Applies when**: none of the 4 methods above hit, or you want to infer semantics
directly from the value pattern.

```bash
# run a 6-batch diff to see each DYNAMIC field's value pattern
python ../scripts/identify_dynamic_semantics.py \
    field_classes.json \
    --samples samples/<site>
# -> outputs the inferred semantics of each DYNAMIC field (timestamp/UUID/HMAC/...)
```

Classify by value pattern:

| Pattern across 6 sample batches | Inference |
|---|---|
| all identical | STATIC, copy from batch 1 |
| all 6 differ, 13-digit number | `Date.now()` |
| all 6 differ, UUID format | `uuidV1()` or `state.{pxsid,vid,cts}` |
| all 6 differ, 32 hex | HMAC-MD5 (check context for input) |
| all 6 differ, 64 hex | SHA-256 / state.qa |
| all 6 differ, long base64 | `/ns sm` |
| all 6 differ, large int 1e7-1e9 | `performance.memory.usedJSHeapSize` |
| all 6 differ, float 0-10000 | `performance.now()` |
| all 6 differ, object | nested (e.g. `navigator.connection`) |
| present in only some batches | CONDITIONAL (warm-visit field) |

---

## Standard Locating Procedure (per unknown field)

```
I see field d['XXX='] in EV2 with value V
  │
  ├─ Is V a browser property like "Win32"/"webkit"/number 1920?
  │   → Method A: grep navigator.platform or the matching API
  │
  ├─ grep "XXX=" directly in the SDK?
  │   → Method B: read the context to see how it is assigned
  │   → hit the assignment expression = source found ✓
  │
  ├─ B missed? reverse-lookup the hQ dictionary to check for indirect reference
  │   → Method C: find the N for hQ(N), then grep the hQ(N) call
  │
  ├─ inspect V's pattern (hash/UUID/ts/memory)
  │   → Method D: use magic constants to locate the nearby code
  │
  └─ none work? final fallback
        → Method E: cross-batch diff, classify by value pattern
        → cannot grep but can infer (timestamp/HMAC/...)
```

---

## Case Study: Locating Key DYNAMIC Fields in iFood EV2

Tracing each field's source in practice (across methods A-E):

### 1. `RTEwewNQMUg=` → `parseInt(state.no)` ⭐⭐⭐

```bash
# Method B
grep -boE '"RTEwewNQMUg="' main.min.js
# -> 7675:"RTEwewNQMUg="] % 10 + 1); t["egoPQD9rD3I="]...
```

Read the context:

```js
// the line above is actually the anti-tamper location;
// the real assignment is elsewhere:
"RTEwewNQMUg=": parseInt(t.no),   // <- state.no coerced to number
```

### 2. `VQEgCxNnKjw=` → `Date.now()`

```bash
grep -boE '"VQEgCxNnKjw="' main.min.js
# -> 10093: i.d["VQEgCxNnKjw="] = qj()
```

In context, `qj()` is PX's initTime getter, which is internally just `Date.now()`.

### 3. `M2MGKXUOBB8=` → `HMAC-MD5(uuid, UA)`

The value looks like 32 hex (e.g. `5ce8e2d80f4d74636045c6b38ef4aee0`) -> Method D:

```bash
grep -boE '"M2MGKXUOBB8="' main.min.js
# after the hit, read the context:
# d["M2MGKXUOBB8="] = iR(oB(), t)
# iR = HMAC, oB() = uuid, t = UA
```

### 4. `Czt+cU1WeEM=` → `new Date().toString()`

The value is in the form `"Tue May 19 2026 ..."` -> Method A:

```bash
grep -boE 'new Date\(\)\.toString\b\|hS\.toString' main.min.js
# after the hit, see which field it is assigned to
```

### 5. `NABBSnJgQXE=` → `performance.memory.usedJSHeapSize`

The value is an 8-digit integer (e.g. `106414918`) -> Method A:

```bash
grep -nE 'usedJSHeapSize\|performance\.memory' main.min.js
# after the hit, see the nearby field assignment
```

### 6. `BzdyfUJXdks=` → /ns sm response

The value is a ~30-byte base64 (e.g. `3rxcTzITchdNlbgaO9_MUu8IqNIMSoBu...`) ->
Method D + E:

```bash
# Method D: /ns URL
grep -nE 'tzm.px-cloud.net' main.min.js

# see the nearby field assignment
grep -B5 -A5 'tzm.px-cloud.net' main.min.js | grep -oE '"[A-Za-z0-9+/]{8,}=="'
```

---

## Tool: One-Shot Location of All EV2 Fields

Write a script that runs the full locating procedure on every field in the EV2
template:

```bash
# field_locator.sh
#!/bin/bash
EV2_TEMPLATE="$1"   # decoded EV2 JSON
SDK="$2"
HQ_MAP="${3:-hQ_map.json}"

# extract all b64 keys
keys=$(jq -r '.[0].d | keys[]' "$EV2_TEMPLATE")

for key in $keys; do
    # Method B: plaintext grep
    plain_pos=$(grep -boE "\"$key\"" "$SDK" | head -1)
    if [ -n "$plain_pos" ]; then
        ctx=$(grep -oE "\"$key\".\{0,80\}" "$SDK" | head -1 | cut -c1-100)
        echo "$key: plain@$plain_pos | $ctx"
        continue
    fi

    # Method C: hQ reverse-lookup
    N=$(jq -r --arg t "$key" 'to_entries[] | select(.value == $t) | .key' "$HQ_MAP" | head -1)
    if [ -n "$N" ]; then
        hq_pos=$(grep -boE "hQ\\(\\s*$N\\s*\\)" "$SDK" | head -1)
        echo "$key: via_hQ($N)@$hq_pos"
        continue
    fi

    # Method E: mark as needing diff inference
    echo "$key: NOT_FOUND (try cross-sample diff)"
done
```

Run it once to bucket all fields into 3 classes:

- `plain`: direct grep hit (easiest to handle)
- `via_hQ(N)`: indirect via dictionary (medium)
- `NOT_FOUND`: needs cross-sample diff (the few hard cases)

---

## Field Type → Source Type Decision Table

| Field value type | Primary method | Secondary method |
|---|---|---|
| `"Win32"/"webkit"` and similar strings | A (navigator API) | B (plaintext grep) |
| `1920/1080` and similar screen numbers | A (screen API) | B |
| fixed boolean `true/false` | B (plaintext grep) | E (diff) |
| 13-digit ms timestamp | A (Date.now) or D (state.no) | E |
| UUID (36 chars) | A (uuidV1) or D (state.pxsid) | E |
| 32 hex (HMAC) | D (around 909522486) | B + E |
| 64 hex (SHA) | D (state.qa) | E |
| long base64 (40+ chars) | A (/ns sm) | E |
| large int 1e7-1e9 (memory) | A (performance.memory) | D |
| float 0-10000 (perf.now) | A (performance.now) | D |
| nested object | A or B | E |
| irregular string | E (diff inference) | - |

---

## Field Overview Case: Classifying the 209 iFood EV2 Fields

```
Direct browser API reads      ~80 fields (38%)
  navigator.* (~30)
  screen.* (~10)
  document.* (~10)
  performance.memory (~5)
  location.* (~3)
  window.* (~5)
  other (~17)

Fixed literals (boolean/number)  ~45 fields (21%)
  webdriver probes (true/false)
  various security flags

PX algorithm functions        ~30 fields (14%)
  initTime, sendTime (Date.now)
  uuid (uuidV1)
  Date.toString
  HMAC × 3 (uuid/vid/pxsid + UA)
  performance.now
  memory.used + total
  /ns sm + duration
  error stacks
  other dynamic counters

state.* injection             ~9 fields (4%)
  state.no, state.to, state.qa, state.vid,
  state.pxsid, state.appId, state.cts, state.jf, state.o111val

anti-tamper                    1 pair (key + value)

cross-sample diff inference    ~30 fields (14%)
  various hashes / counters / probe results
  need 6-batch sample comparison to infer semantics
```

---

## Related Resources

| What you want | Where |
|---|---|
| Field three-way classification (STATIC/DYNAMIC/CONDITIONAL) principles | [`../references/field-categories.md`](../references/field-categories.md) |
| Locating key functions (hQ/mh/Dd etc.) | [`locate-functions.md`](locate-functions.md) |
| Reversing the 9 encryption algorithms | [`reverse-algorithms.md`](reverse-algorithms.md) |
| Full EV1/EV2 field semantics table | [field-categories.md](../references/field-categories.md) (field semantics) |
| Ready-made field mapping | a per-site EV2 template (e.g. `ifood_ev2_template.json`) |
| Automated locating scripts | [`../scripts/lookup_keys.js`](../scripts/lookup_keys.js) + [`../scripts/probe_dynamic.js`](../scripts/probe_dynamic.js) |

---

*Combining the 5 tools (methods A-E), you can typically locate ~85% of a new SDK's
200+ fields, with the remaining 15% inferred via diff. Full localization = you can
write a complete generator.*
