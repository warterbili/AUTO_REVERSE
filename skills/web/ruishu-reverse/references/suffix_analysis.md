# Phase 6: URL Suffix Analysis

## Current Status

Validated through extensive real-world testing across many sites: **99% of Ruishu sites do not require a URL suffix for POST requests** — only the S and T values in the Cookie are needed to pass validation.

Only a very small number of sites require a suffix on GET requests or specific endpoints; in the vast majority of cases the pure-Cookie approach is sufficient.

---

## Suffix Structure

Two variants exist: 88 bytes (no search) and 120 bytes (with search).

### 88B Variant (URL Without Query String)

```
Offset     Length  Content        Description
[0-3]      4B     nonce          Random number
[4]        1B     flag = 1       Fixed flag bit
[5]        1B     = 0x6a         Site marker
[6-54]     49B    session        Derived from Cookie S decryption (internal VM state, fixed per session)
[55]       1B     marker         0x20 = no search / 0x40 = has search
[56-87]    32B    sig32          Behavioral statistics encoding
```

### 120B Variant (URL With Query String)

```
Offset     Length  Content        Description
[0-87]     88B    Same as 88B structure above
[88-119]   32B    searchSig      SHA-1 signature of the search portion
```

### Encoding Scheme

```
"0" + URLSafeBase64(bytes)

URL-safe substitution rules:
  + -> .
  / -> _
  No padding (trailing = removed)
```

---

## Parameter Name Retrieval

The parameter name used when appending the suffix to the URL is extracted from the following location:

```javascript
keys[7].split(';')[1]
```

Here `keys` is the Ruishu config array; `keys[7]` contains multiple semicolon-delimited config items, and the second segment is the suffix parameter name.

---

## Suffix Generation Flow (Obtained via AST Tracing)

1. **XHR.open interception**: Ruishu hooks XMLHttpRequest.prototype.open, so all XHR requests pass through Ruishu logic
2. **URL parsing**: A temporary link element is created via `createElement('a')`, and the browser automatically parses out the pathname and search
3. **VM execution**: The `r2mKa` VM bytecode executes the `child[29]` node, which is responsible for computing and assembling the suffix
4. **URL appending**: Once computed, the suffix is appended to the original URL as a new query parameter

---

## 32B Signature: Behavioral Statistics Encoding

The 32-byte signature in the suffix (offset 56-87) is **not the output of an encryption algorithm**, but rather an encoding of behavioral statistics data:

- Mouse movement trajectory statistics
- Keyboard event statistics
- Other browser behavior metrics

This data is encoded into a fixed 32 bytes, used by the server to determine whether the request originates from a real browser.

---

## SHA-1 Signature Discovery

The last 32 bytes (`searchSig`) of the 120B variant have been confirmed to be a SHA-1 signature. Evidence:

- **rt[67] constants**: The VM runtime array `rt[67]` stores the SHA-1 algorithm initialization constants
- **4 SHA-1 functions**: AST tracing located 4 standard SHA-1 round functions, fully consistent with RFC 3174
- The signature target is the search portion (query string) of the URL

XTEA or AES encryption was previously suspected, but data-driven comparison confirmed it is actually SHA-1.

---

## AST Findings Summary

| Finding | Description |
|--------|------|
| Suffix encoding scheme | URLSafeBase64, prefix "0" |
| 88B / 120B structure | Complete field mapping |
| Parameter name source | keys[7].split(';')[1] |
| XHR hook mechanism | createElement('a') URL parsing |
| VM entry point | child[29] node |
| Signature algorithm | SHA-1 (not XTEA/AES) |
| 32B sig | Behavioral statistics encoding (not encryption) |

---

## Open Questions

### 49B session Data (Offset 6-54)

- Derived from the decryption of Cookie S
- Generated and maintained inside the VM, fixed per session
- The complete generation logic has not yet been extracted from the VM bytecode

### VM Bytecode Level

- The complete execution path of child[29] has not been fully reconstructed
- The transition logic of the internal VM state machine is complex
- Bytecode-level pure-computation reconstruction is a large effort

---

## Available Approaches

### Approach 1: JsRpc (Recommended, Generic)

Remotely invoke the Ruishu JS environment already loaded in the browser to directly obtain the generated result.

- Pros: Highly generic, works for all sites, no need to understand internal logic
- Cons: Depends on a browser instance, with some performance overhead

### Approach 2: sdenv In-VM XHR

Use the sdenv environment to execute Ruishu JS and issue an XHR request from inside the VM.

- Pros: No browser required, scriptable
- Cons: Each sdenv instance can only send one POST request, requiring frequent initialization of new instances

### Approach 3: Pure Computation (For Sites That Do Not Need a Suffix)

For the 99% of sites that do not need a suffix, only Cookie S and T need to be computed.

- Pros: Best performance, fully decoupled from the browser
- Cons: Only applicable to scenarios that do not need a suffix

---

## Future Directions for a Pure Suffix Implementation

To achieve a fully browser-free pure-computation suffix:

1. **49B session reconstruction**: Requires diving into the VM bytecode to trace the complete processing chain after Cookie S decryption
2. **Behavioral statistics simulation**: The 32B sig needs to be filled with plausible behavioral data, which can reference samples collected from a real browser
3. **SHA-1 computation**: The algorithm for the search-portion signature is already identified and can be implemented directly
4. **Encoding assembly**: All field structures are already clear, so the assembly and encoding logic can be implemented directly

The key bottleneck is the generation of the 49B session data, which is buried deep in the VM bytecode execution flow and is the final obstacle for a pure-computation approach.
