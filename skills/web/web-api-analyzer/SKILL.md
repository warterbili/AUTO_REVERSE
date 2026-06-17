---
name: web-api-analyzer
description: Analyze website API endpoints and JS logic using Playwright. Intercept network requests, extract API patterns, capture encrypted parameters, and export HAR files. Use when the user wants to reverse-engineer a website's API calls, analyze request/response patterns, or understand JS encryption logic.
metadata:
  requirements:
    bins: [node]
    npm: [playwright]
---

# Web API Analyzer

A Playwright-based tool for intercepting and analyzing website API calls and JS logic.

## Capabilities

1. **Network Interception** — Capture all XHR/Fetch API requests with full headers, params, and response bodies
2. **API Pattern Extraction** — Auto-identify API endpoints, auth methods, and request patterns
3. **JS Analysis** — Inject JS to hook crypto functions (e.g., `encrypt`, `sign`, `md5`), intercept `XMLHttpRequest` and `fetch`
4. **HAR Export** — Save full network traffic as HAR for further analysis
5. **Cookie/Token Tracking** — Track auth tokens, cookies, and session changes

## Usage

### 1. Basic API Capture

Capture all API requests from a URL:

```bash
node <skill_dir>/scripts/capture.cjs --url "https://example.com" --duration 15000 --output /tmp/api-capture.cjson
```

Options:
- `--url` (required): Target URL
- `--duration`: How long to capture in ms (default: 10000)
- `--output`: Output file path (default: stdout as JSON)
- `--har`: Export as HAR format instead of JSON
- `--filter`: Regex to filter URLs (e.g., `--filter "api|ajax"`)
- `--click`: CSS selector to click after page load (triggers more API calls)
- `--scroll`: Auto-scroll the page to trigger lazy-load APIs
- `--headers`: Show full request/response headers
- `--body`: Capture response bodies (can be large)
- `--cookie`: Include cookies in output

### 2. JS Hook Analysis

Inject hooks to monitor JS crypto/encoding functions:

```bash
node <skill_dir>/scripts/js-hook.cjs --url "https://example.com" --hook crypto --duration 15000
```

Hook types:
- `crypto` — Hook Web Crypto API, CryptoJS, JSEncrypt, md5, etc.
- `fetch` — Hook fetch() and XMLHttpRequest with full params
- `storage` — Hook localStorage/sessionStorage access
- `cookie` — Hook document.cookie read/write
- `all` — All of the above

### 3. Interactive Analysis

For complex sites, use the interactive mode which opens a headed browser:

```bash
node <skill_dir>/scripts/capture.cjs --url "https://example.com" --headed --duration 60000
```

This allows manual interaction while all network traffic is captured.

## Workflow

1. Start with basic capture to see all API endpoints
2. Identify interesting endpoints (auth, data, search)
3. Use JS hooks to understand encryption/signing logic
4. Reconstruct the API call independently

## Output Format (JSON)

```json
{
  "url": "https://example.com",
  "timestamp": "2025-01-01T00:00:00Z",
  "requests": [
    {
      "url": "https://api.example.com/v1/data",
      "method": "POST",
      "headers": { ... },
      "postData": "...",
      "response": {
        "status": 200,
        "headers": { ... },
        "body": "..."
      },
      "timing": { "start": 0, "duration": 123 }
    }
  ],
  "cookies": [...],
  "jsHooks": [...]
}
```
