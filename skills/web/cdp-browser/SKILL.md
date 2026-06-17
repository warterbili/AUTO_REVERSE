---
name: cdp-browser
description: Drive a real Chrome browser via CDP (Chrome DevTools Protocol) for web automation, reverse-engineering, and information gathering. No webdriver fingerprint, does not trigger anti-bot defenses. Use cases: (1) website reverse-engineering (capturing APIs, analyzing JS, intercepting network requests); (2) web search and data collection; (3) web automation that must evade bot detection; (4) analyzing XHR/Fetch/WebSocket traffic; (5) any task requiring a real browser to access a website. Prefer this over the web_search, web_fetch, and browser tools.
---

# CDP Browser Skill

Control a browser with real Chrome + the CDP protocol — no webdriver injection, no bot fingerprint.

## Core script

`scripts/cdp.py` — the entry point for all operations. Read this script first to understand the API, then call it as needed.

## Quick start

### 1. Launch Chrome and connect

```bash
# Launch Chrome (if not already running)
python3 scripts/cdp.py start

# Check status
python3 scripts/cdp.py status
```

### 2. Common operations (run directly via exec)

```bash
# Navigate to a page
python3 scripts/cdp.py navigate "https://example.com"

# Screenshot (saved to workspace)
python3 scripts/cdp.py screenshot "/path/to/save.png"

# Get page HTML
python3 scripts/cdp.py html

# Run JS
python3 scripts/cdp.py eval "document.title"

# Capture network requests (listen for N seconds)
python3 scripts/cdp.py network 10

# Click an element (CSS selector)
python3 scripts/cdp.py click "#submit-btn"

# Type text
python3 scripts/cdp.py type "#search-input" "keyword"

# Scroll the page
python3 scripts/cdp.py scroll 0 500

# Wait for an element to appear
python3 scripts/cdp.py wait ".result-list" 10

# Get cookies
python3 scripts/cdp.py cookies

# Stop Chrome
python3 scripts/cdp.py stop
```

### 3. Embedding in a Python script

For complex flows, write a Python script that calls `CDPClient` directly:

```python
import asyncio, sys
sys.path.insert(0, '<cdp-browser-skill>/scripts')
from cdp import CDPClient, launch_chrome, get_tabs

async def main():
    launch_chrome()  # launch if not already running
    tabs = get_tabs()
    async with CDPClient(tabs[0]['webSocketDebuggerUrl']) as cdp:
        await cdp.navigate('https://example.com')
        await cdp.wait_for_selector('.content')
        html = await cdp.get_html()
        requests = await cdp.capture_network(5)
        print(requests)

asyncio.run(main())
```

## Reverse-engineering workflow

1. `navigate` to the target site
2. `network` — listen for requests to find API endpoints
3. `eval` — run JS to inspect page variables and global objects
4. `html` — grab the full DOM
5. `screenshot` — record page state

See `references/reverse-tips.md` for detailed reverse-engineering techniques.

## ⚡ Recommended alternative: agent-browser native mode

The `--native` mode of `agent-browser` is a lighter, pure-Rust CDP solution well suited to reverse-engineering:

```bash
# Must be launched via env var (the --native flag has a bug: it is ignored when the daemon is already running)
export AGENT_BROWSER_NATIVE=1

# Open a page
agent-browser open https://example.com

# Capture network requests (two-step approach recommended)
agent-browser network requests --clear
agent-browser open https://target.com
sleep 2
agent-browser network requests

# Screenshot
agent-browser screenshot --output /path/to/save.png

# Run JS
agent-browser eval "document.title"

# Get HTML
agent-browser html

# Stop the daemon
pkill -f agent-browser
```

**Advantages over the cdp.py script:**
- No Node.js/Playwright required — pure Rust, faster startup
- Cleaner network-request capture (direct CDP)
- Supports Chromium + Safari (Firefox/WebKit not supported)

**Why two-step network capture:** the native daemon only records requests made after it opens, so you must `--clear` first, then `open`.

---

## Technical notes

- Chrome process: uses an isolated, dedicated profile (default `tempfile.gettempdir() / chrome-cdp-profile`,
  i.e. `/tmp/...` on macOS/Linux and `%TEMP%\...` on Windows), kept separate from your normal browser.
  Override with the `CHROME_PROFILE` env var.
- Chrome binary: auto-detected per `sys.platform`
    - macOS:   `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`
    - Linux:   `/usr/bin/google-chrome` / `/usr/bin/chromium`, etc.
  Override with the `CHROME_BIN` env var.
- CDP port: `localhost:9222`
- Dependencies: Python 3 standard library + `websockets` (already installed)
- No Playwright/Selenium, no webdriver fingerprint
