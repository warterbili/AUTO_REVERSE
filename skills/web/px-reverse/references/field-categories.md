# EV2 Field Three-Way Classification Rules

## Overview

ev2 (collector#2 events) typically has 200+ fields. After comparing multiple sample batches, they group as follows:

```
228 fields (4-batch union)
├── STATIC (~75%, 171 fields): identical across all 4 batches → copy template verbatim
├── DYNAMIC (~15%, 32 fields): differs per batch → generated algorithmically
└── CONDITIONAL (~10%, 25 fields): present only on warm visits → ignorable on cold visits
```

## DYNAMIC fields that MUST be generated algorithmically (17 core fields)

| Field semantics | Algorithm |
|---|---|
| server timestamp | `parseInt(state.no)` ⭐ number type! |
| initTime | `Date.now()` |
| sendTime | initTime + 1000~1500ms |
| pre-init ts | initTime - 200~400ms |
| session UUID | `uuidV1()` |
| Date.toString() | `new Date().toString()` |
| performance.now() | sendTime - initTime |
| HMAC(uuid, UA) | hmacMD5 |
| HMAC(vid, UA) | hmacMD5 |
| HMAC(pxsid, UA) | hmacMD5 |
| state.appId | from ob#1 |
| state.to | from ob#1 |
| memory used | random 40-140M |
| memory total | used × 1.1~1.5 |
| /ns sm | fetched from /ns |
| /ns duration | fetched from /ns |
| anti-tamper key/val | te(state.to, state.no%10+2/1) |

## ENTROPY fields (DYNAMIC but fixed for the same browser + same GPU)

These field values should always be the same on the **same browser with the same GPU**. Just use the template:

- Canvas hash (32 hex)
- Audio fingerprint hash
- Error stack hash (kE(nk()))
- Font hash
- Mouse track AN() count

## CONDITIONAL fields (warm-visit only)

batch1/2 have 25 more fields than batch3-6. These are all session-injection related:
- Historical _px3 token
- pxhd / hid previous value
- challenge state cache

**Cold-visit baseline = 204 fields, sufficient to pass validation.** The extra fields from warm visits have no effect on the result (and may even interfere).

## STATIC fields (use template values directly)

The remaining ~170 fields are fixed browser values; just use the template from a real capture. These include:

- screen.width = 1920
- screen.height = 1080
- navigator.platform = "Win32"
- hardwareConcurrency = 8
- deviceMemory = 8
- timezone = "Asia/Shanghai"
- timezone offset = -480
- navigator.languages = [...]
- userAgent (must match the UA in the HTTP header!)
- navigator.plugins JSON
- Various webdriver/phantom/selenium detection fields = false
- Various API-existence fields
- etc.
