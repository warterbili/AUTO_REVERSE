# CDP Skill — Real Chrome Controller

> Control a real Chrome browser via the Chrome DevTools Protocol. **No webdriver fingerprint**,
> so it is not detected by anti-bot SDKs such as PerimeterX / Cloudflare / DataDome.

## Directory structure

```
skill/cdp/
├── README.md                          ← this file
├── SKILL.md                            ← general skill usage guide
├── scripts/
│   ├── cdp.py                          ← general CDP controller (CLI + Python API)
│   ├── capture_sdk_via_cdp.py          ← capture anti-bot SDK .js + collector POST (clears cookies/cache)
│   ├── capture_api_via_cdp.py          ← capture collector / API POST (per-batch isolation via BrowserContext)
│   └── fetch_sdk.py                    ← single-page capture of anti-bot SDK resources (matched by URL substring)
└── references/
    └── reverse-tips.md                 ← reverse-engineering tips cheat sheet
```

## Two-layer architecture

**Layer 1 — general CDP tool (`scripts/cdp.py`)**

Reusable in any CDP project. Provides 11 CLI commands:

```bash
python skill/cdp/scripts/cdp.py start       # launch Chrome
python skill/cdp/scripts/cdp.py navigate <URL>
python skill/cdp/scripts/cdp.py network <SEC>
python skill/cdp/scripts/cdp.py eval <JS>
python skill/cdp/scripts/cdp.py screenshot <PATH>
python skill/cdp/scripts/cdp.py html
python skill/cdp/scripts/cdp.py cookies
python skill/cdp/scripts/cdp.py click <SELECTOR>
python skill/cdp/scripts/cdp.py type <SELECTOR> <TEXT>
python skill/cdp/scripts/cdp.py status
python skill/cdp/scripts/cdp.py stop
```

You can also import `CDPClient` directly in Python. See [`SKILL.md`](SKILL.md) for details.

**Layer 2 — anti-bot capture scripts (`scripts/capture_*_via_cdp.py`, `fetch_sdk.py`)**

Generic anti-bot capture wrappers built on `cdp.py`. Every target value (URL / SDK domain /
collector path) is a command-line argument; the defaults are placeholders (`https://example.com`),
and the default SDK example is PerimeterX (`client.px-cloud.net` / `/api/v2/collector`).

| Script | What it captures | Isolation method |
|---|---|---|
| `capture_sdk_via_cdp.py` | anti-bot SDK `.js` + collector POST | clears cookies/cache each batch |
| `capture_api_via_cdp.py` | collector / API POST requests + responses | per-batch isolation via `Target.createBrowserContext` |
| `fetch_sdk.py` | SDK resources matched on a single page (by URL substring) | temporary profile |

What each batch does:

1. Fresh Chrome profile / BrowserContext + clear cookies/cache
2. Start CDP and subscribe to `Network.requestWillBeSent` / `Network.responseReceived` / `Network.loadingFinished`
3. Navigate to the target page and wait for the anti-bot SDK to complete its collector POST
4. Save the full request body + response body
5. Compute the SDK SHA-256 and write it to meta.json (cross-batch consistency check)

Usage (parameterized examples):

```bash
# Capture SDK + collector, run 6 batches
python skill/cdp/scripts/capture_sdk_via_cdp.py 6 \
    --url https://example.com/ \
    --sdk-domain client.px-cloud.net \
    --collector-path /api/v2/collector

# Capture collector/API with per-batch BrowserContext isolation
python skill/cdp/scripts/capture_api_via_cdp.py 6 \
    --url https://example.com/ \
    --sdk-domain client.px-cloud.net \
    --collector-path /api/v2/collector

# Single-page capture of SDK resources (matched by URL substring)
python skill/cdp/scripts/fetch_sdk.py \
    --url https://example.com/login \
    --match px-cloud.net --match perimeterx --match /init.js
```

With no arguments, the scripts default to the placeholder target `https://example.com`, useful only
to verify that they run; when reversing a real target, replace `--url` / `--sdk-domain` / `--collector-path`
with the actual values.

## Why not Selenium / Playwright

| Tool | webdriver fingerprint | anti-bot reaction |
|---|---|---|
| Selenium | `navigator.webdriver = true` and 10+ other signals | banned immediately |
| Playwright (default) | same as above + multiple automation traces | banned immediately |
| **CDP direct to real Chrome** | **zero injection, zero traces** | **normal user** |

CDP talks to a real Chrome process directly via `--remote-debugging-port`, **injecting no
JS and modifying no navigator properties**. This is currently the only way to capture clean anti-bot traffic.

## Documentation reference

For the full usage manual, see [`../../main/ZH/PX_完整SDK对照逆向方法论.md`](../../main/ZH/PX_完整SDK对照逆向方法论.md),
the ★ section ("Traffic capture and SDK pinning").
