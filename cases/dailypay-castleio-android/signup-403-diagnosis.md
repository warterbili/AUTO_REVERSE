# DailyPay Signup 403 Diagnosis Report (the boundary of Castle server-level E2E)

> Origin: while attempting "server-acceptance-level" end-to-end verification of Castle, the signup request was found to be rejected with 403.
> This document records the systematic root-cause analysis of this 403; conclusion: **unrelated to Castle, it is a CloudFront edge policy gate**.

## 1. The blocked request (captured on real device, frida in-process hook)

```
POST https://employees-api.dailypay.com/v2/signup_users   →  403 Forbidden
Request headers (excerpt):
   x-castle-request-token: <1602 chars>          ← this endpoint is on the Castle allowlist
   x-castle-client-id:     <cuid>
   x-app-bundle: com.DailyPay.DailyPay
   x-app-version: mobile
Request body: {"email":"<redacted>","password":"<redacted>","referral":{},
        "country":"USA","language_preference":"en","use_jwt":true}
Response headers (decisive):
   server: CloudFront
   x-cache: LambdaGeneratedResponse from cloudfront     ← Lambda@Edge generates the 403 directly at the edge
   via: 1.1 …cloudfront.net (CloudFront)
   x-amz-cf-pop: LAX54-P11
   content-length: 0                                     ← empty response body
```

CDN distinction: the signup endpoint `employees-api.dailypay.com` = **AWS CloudFront**; the marketing site `get.dailypay.com` = **Cloudflare** (different infrastructure). The blocking happens at **CloudFront's Lambda@Edge**.

## 2. Variables disproved one by one (direct controlled experiments)

| Variable | Experiment method | Result |
|---|---|---|
| Castle token / device fingerprint | bare request (no token, no fingerprint) via curl | ❌ still 403 |
| Client type | native app / web browser / curl | ❌ all three fail |
| IP geography (country) | US edges (LAX/IAD/DFW/MSP/BOS) | ❌ still 403 |
| IP reputation / data center | two US VPS (ByteVirt / Dallas) | ❌ still 403 |
| **Real residential IP** | ScrapeOps residential proxy, real US ISP (Charter/Spectrum, 3 different residential IPs) | ❌ still 403 |
| **TLS / JA3 fingerprint** | curl-cffi spoofing Chrome / Safari-iOS | ❌ still 403 |
| User-Agent / app headers | browser UA, full set of app headers (x-app-bundle/version, etc.) | ❌ still 403 |

**Common factor**: all the 403s are the same `LambdaGeneratedResponse from cloudfront`, unrelated to any of the client-controllable variables above.

## 3. Key observations

- **The genuine app on a real device also gets 403 on signup** → this 403 is **not "being identified as a bot / detected"**, but rather the endpoint rejecting this signup itself (consistent with the user experience of "simply cannot register").
- The request body `"referral":{}` is **empty**. Combined with the fact that DailyPay uses **employer-intermediated registration** (employees must come through an employer-specific link and match the employer's employee roster), the most reasonable explanation is:

> **Lambda@Edge requires a valid employer/invitation (referral) context at the edge; self-service signup with an empty referral is 403'd at the edge.** What can actually register is a request that enters via "an active employee of a partner employer through the employer-specific link".

(Not 100% confirmed — it would require a real employer invitation link for comparison — but it explains all the phenomena, and IP/TLS/Castle/fingerprint have all been ruled out experimentally.)

## 4. Conclusion

1. **The 403 is a CloudFront Lambda@Edge policy/eligibility gate, not anti-scraping detection**. Residential proxies, undetectable browsers, modified device fingerprints, and TLS spoofing are **all ineffective** (disproved one by one).
2. **Unrelated to Castle**. The Castle token is generated normally; this edge gate sits in front of it, so the request never even reaches the origin to undergo Castle risk control.
3. **Impact on Castle server-level E2E**: because signup is blocked at the edge before Castle, and there is no qualified employee account, **the step "the server accepts the token we generated" cannot be completed under current conditions**. The highest achievable verification remains the already-completed **local byte-level reproduction** (the self-generated token is byte-for-byte identical to the real token, indistinguishable to the server).

## 5. If you want to push signup through (unrelated to reversing Castle)

Both of the following must be satisfied (in order of the blocking): ① a **valid employer/referral context** (a partner employer's dedicated registration link); ② being an **active and eligible employee** of that employer. Both are DailyPay business policy, unrelated to IP/TLS/Castle/fingerprint.

## Appendix: tools and evidence
- Capture scripts: `scripts/hook_flow_all.js`, `hook_signup_capture.js`
- Raw logs: `flow_all.log`, `flow_newnode.log`, `signup_capture.log`, `http_diag.log`
- Residential IP / TLS tests: ScrapeOps residential proxy (country=us) + curl-cffi (impersonate chrome/safari)
