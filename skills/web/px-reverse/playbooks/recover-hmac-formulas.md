# Playbook: Recovering HMAC / MD5 Field Formulas

> When your EV2 contains 32-character hex fields (obviously HMAC-MD5 or MD5 outputs), **the input for each of these fields must be confirmed by empirical crypto testing across all 6 batches; it cannot be copied from another site** (Gotcha #18).
>
> Estimated time: **5-15 minutes** per field

## When to use this playbook

- You're writing a generator for a new site
- You discover some EV2 fields are 32-char hex (suspected md5/HMAC-md5 outputs)
- In legacy code, the inputs for these fields were copied from another site (iFood/Grub) without empirical verification
- Or Layer 3.5 verification failed, and `compare_ev2_field_by_field` shows HMAC field values don't match

## SOP (5 steps)

### Step 1 — Find candidate fields

```bash
# See which fields in the EV2 template are 32-char hex
python -c "
import json
ev2 = json.load(open('samples/1/decoded_payload_2.json'))[0]['d']
for k, v in ev2.items():
    if isinstance(v, str) and len(v) == 32 and all(c in '0123456789abcdef' for c in v):
        print(f'  {k}  = {v}')
"
```

Example output (totalwine):

```
  Cho5UEx3PWY=  = 70f2bc836c01ecb903f202505091af03
  Lx8cFWl9HCE=  = 7ed349089b27e290590e527262334019
  UiJhKBREYhs=  = d224bc2e09bb708a1f3920fadc261bca
  EFwjFlU8JyU=  = f710b5af53612e6bff25c1bd44bf7f14
```

### Step 2 — grep the assignment point of each b64 key in the SDK

```bash
python << 'EOF'
import re
sdk = open('source/main.min.js', encoding='utf-8', errors='ignore').read()
for k in ['Cho5UEx3PWY=', 'Lx8cFWl9HCE=', 'UiJhKBREYhs=', 'EFwjFlU8JyU=']:
    print(f'\n=== {k} ===')
    for m in re.finditer(re.escape(k), sdk):
        s = max(0, m.start()-150); e = min(len(sdk), m.end()+150)
        print(f'  pos {m.start()}: ...{sdk[s:e]}...')
EOF
```

Expect to see something like:

```js
n["<b64-key>="] = jm(X(), Y())   // jm = HMAC-MD5; X(), Y() = input + key
n["<b64-key>="] = qT()           // single arg → internally md5/jl(i)
```

### Step 3 — Inspect the X() / Y() function definitions

```bash
python << 'EOF'
import re
sdk = open('source/main.min.js', encoding='utf-8', errors='ignore').read()
def find_braced(start_idx):
    depth = 0; in_str = False; quote = None
    i = sdk.index('{', start_idx); depth = 1; i += 1
    while i < len(sdk) and depth > 0 and (i - start_idx) < 4000:
        c = sdk[i]
        if in_str:
            if c == '\\': i += 2; continue
            if c == quote: in_str = False
        elif c in '"\'':
            in_str = True; quote = c
        elif c == '{': depth += 1
        elif c == '}': depth -= 1
        i += 1
    return sdk[start_idx:i]
for fn in ['oU', 'ku', 'qy', 'qT', 'jm']:   # replace with the function names you found in Step 2
    m = re.search(rf'function {re.escape(fn)}\(', sdk)
    if m: print(f'\n=== {fn} ===\n  {find_braced(m.start())[:500]}')
EOF
```

Expect to find:
- `oU()` returns uuid (`oS=oY()||kL("uuid")||nS()`)
- `qy()` returns the value of some sessionStorage key
- `qT()` returns the value of some storage key
- `ku()` returns some global var (then grep that var's assignment point)

### Step 4 — Cross-batch crypto enumeration & verification across all 6 batches

For each HMAC field, candidate inputs are usually:
- `uuid` (most common)
- `state.vid`, `state.pxsid`, `state.cts` (uuid-format state)
- `state.no`, `state.to` (numeric-format state)
- `state.qa` (64-hex sha256)
- cookie values from the `OOOllO` segment in response_1 (`cc`, `idp_c`)

```bash
python << 'EOF'
import json, hmac, hashlib

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

def hm(s, k): return hmac.new(k.encode(), s.encode(), hashlib.md5).hexdigest()
def md5(s): return hashlib.md5(s.encode()).hexdigest()

# The fields you want to verify
TARGET_FIELDS = ['Cho5UEx3PWY=', 'Lx8cFWl9HCE=', 'UiJhKBREYhs=', 'EFwjFlU8JyU=']

results = {f: {} for f in TARGET_FIELDS}
for i in range(1, 7):
    ev2 = json.load(open(f'samples/{i}/decoded_payload_2.json'))[0]['d']
    resp1 = json.load(open(f'samples/{i}/decoded_response_1.json'))
    meta = json.load(open(f'samples/{i}/meta.json'))
    uuid = meta['uuid']

    # Extract state from the response_1 segments (adjust to your SDK's segment shape)
    state = {}
    for seg in resp1.get('segments', resp1 if isinstance(resp1, list) else []):
        if not isinstance(seg, str): continue
        parts = seg.split('|')
        if len(parts) >= 2:
            # Classify by segment prefix (example)
            if parts[0] == 'OOllOO': state['pxsid'] = parts[1]
            elif parts[0] == 'lOlOOO': state['vid'] = parts[1]
            elif parts[0] == 'OlllOlll': state['cts'] = parts[1]
            # Add the other prefixes for your site's SDK
            
    # Candidate inputs
    candidates = {
        'uuid': uuid,
        'state.vid': state.get('vid', ''),
        'state.pxsid': state.get('pxsid', ''),
        'state.cts': state.get('cts', ''),
        # Add more candidates
    }

    for fname in TARGET_FIELDS:
        real_val = ev2.get(fname)
        if not real_val: continue
        for cname, cval in candidates.items():
            if not cval: continue
            # HMAC variant
            if hm(cval, UA) == real_val:
                results[fname][f'HMAC({cname}, UA)'] = results[fname].get(f'HMAC({cname}, UA)', 0) + 1
            # MD5 variant
            if md5(cval) == real_val:
                results[fname][f'md5({cname})'] = results[fname].get(f'md5({cname})', 0) + 1

# A 6/6 hit confirms the formula
for fname, scores in results.items():
    print(f'\n{fname}:')
    for formula, count in sorted(scores.items(), key=lambda x: -x[1]):
        ok = '✅' if count == 6 else f'{count}/6'
        print(f'  {ok}  {formula}')
EOF
```

### Step 5 — A 6/6 hit means adopt it

Any formula that scores **6/6** = hits across every batch, confirmed unambiguous.

If a formula only hits 5/6 or fewer → usually some state field was extracted wrong (e.g. `state.vid` and `state.cts` got mixed up in one of the batches). Go back to Step 4 and check the segment prefixes are correct.

If **all candidates score 0/6** → the input isn't among the ones you listed. Expand the candidates:
- canvas fingerprint hash?
- audio fingerprint hash?
- screen dimension string?
- WebGL renderer string?
- a concatenation of multiple state fields (`uuid + state.no`, `state.vid + state.pxsid`, …)?

## totalwine empirical results (for reference)

| Field | Formula | Hit rate |
|---|---|---|
| `Cho5UEx3PWY=` | `HMAC(uuid, UA)` | 6/6 ✅ |
| `Lx8cFWl9HCE=` | `HMAC(state.vid, UA)` | 6/6 ✅ |
| `UiJhKBREYhs=` | `HMAC(state.pxsid, UA)` | 6/6 ✅ |
| `EFwjFlU8JyU=` | `md5(state.vid)` | 6/6 ✅ |

Note: `EFwjFlU8JyU=` is **md5** (single arg `jl(i)`), not HMAC. You can't tell from the 32-hex output shape alone — you must grep the SDK to see whether it's `jm(X)` or `jm(X, Y)`.

## Anti-patterns (don't do this)

- ❌ Seeing a 32-hex value and copying the previous site's `hmac(uuid+':a', UA)` formula
- ❌ Verifying only 1 batch instead of cross-checking all 6
- ❌ Stopping as soon as one HMAC field matches, without verifying the rest (each of the 4 fields must be verified independently)
- ❌ Skipping the SDK grep and brute-forcing the enumeration directly — slow and error-prone

## General rule

**Every 32-hex field, on every new site, must go through these 5 steps.** A one-time 30-minute investment in empirical testing saves hours of blind guessing later when debugging the trust score.
