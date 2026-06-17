#!/usr/bin/env python3
"""
CDP Browser Controller
Real Chrome + CDP protocol, no webdriver fingerprint.
Usage: python3 cdp.py <command> [args...]
"""
import asyncio
import base64
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

CDP_PORT = 9222
CDP_BASE = f"http://localhost:{CDP_PORT}"

import os, sys, tempfile

# Cross-platform Chrome profile dir
CHROME_PROFILE = os.environ.get("CHROME_PROFILE") or os.path.join(
    tempfile.gettempdir(), "chrome-cdp-profile"
)


def _find_chrome_bin():
    """Auto-detect Chrome binary by platform; honor CHROME_BIN env override."""
    override = os.environ.get("CHROME_BIN")
    if override and Path(override).exists():
        return override
    candidates = []
    if sys.platform == "darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
    elif sys.platform.startswith("win"):
        local = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.join(local, r"Google\Chrome\Application\chrome.exe") if local else "",
        ]
    else:  # linux / other unix
        candidates = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise RuntimeError(
        f"Chrome not found. Install Chrome or set the CHROME_BIN env var.\n"
        f"  Paths checked: {candidates}"
    )


CHROME_BIN = _find_chrome_bin() if not os.environ.get("CDP_LAZY_CHROME") else None


# ──────────────────────────────────────────────
# Chrome process management
# ──────────────────────────────────────────────

def launch_chrome(headless=False):
    """Launch Chrome; skip if already running."""
    try:
        get_tabs()
        return  # already running
    except Exception:
        pass

    args = [
        CHROME_BIN,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={CHROME_PROFILE}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
    ]
    if headless:
        args += ["--headless=new", "--disable-gpu"]

    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Wait for Chrome to become ready
    for _ in range(20):
        time.sleep(0.5)
        try:
            get_tabs()
            return
        except Exception:
            pass
    raise RuntimeError("Chrome startup timed out")


def stop_chrome():
    # Cross-platform Chrome kill: taskkill on Windows, pkill on POSIX
    if sys.platform.startswith("win"):
        subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
    else:
        subprocess.run(["pkill", "-f", "Google Chrome"], capture_output=True)
    print("Chrome stopped")


def get_tabs():
    res = urllib.request.urlopen(f"{CDP_BASE}/json", timeout=3).read()
    return json.loads(res)


def get_version():
    res = urllib.request.urlopen(f"{CDP_BASE}/json/version", timeout=3).read()
    return json.loads(res)


def new_tab(url="about:blank"):
    encoded = urllib.parse.quote(url)
    res = urllib.request.urlopen(
        f"{CDP_BASE}/json/new?{encoded}", timeout=5
    ).read()
    return json.loads(res)


# ──────────────────────────────────────────────
# CDP client
# ──────────────────────────────────────────────

class CDPClient:
    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self.ws = None
        self._cmd_id = 0
        self._pending = {}
        self._events = []
        self._network_requests = {}
        self._listen_task = None

    async def __aenter__(self):
        import websockets
        self.ws = await websockets.connect(self.ws_url, max_size=50 * 1024 * 1024)
        self._listen_task = asyncio.create_task(self._listen())
        return self

    async def __aexit__(self, *_):
        if self._listen_task:
            self._listen_task.cancel()
        if self.ws:
            await self.ws.close()

    async def _listen(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if "id" in msg:
                    fut = self._pending.pop(msg["id"], None)
                    if fut and not fut.done():
                        fut.set_result(msg)
                else:
                    self._events.append(msg)
                    await self._handle_event(msg)
        except asyncio.CancelledError:
            pass

    async def _handle_event(self, msg):
        method = msg.get("method", "")
        params = msg.get("params", {})
        if method == "Network.requestWillBeSent":
            req_id = params.get("requestId")
            self._network_requests[req_id] = {
                "url": params.get("request", {}).get("url"),
                "method": params.get("request", {}).get("method"),
                "headers": params.get("request", {}).get("headers", {}),
                "postData": params.get("request", {}).get("postData"),
                "type": params.get("type"),
            }
        elif method == "Network.responseReceived":
            req_id = params.get("requestId")
            if req_id in self._network_requests:
                self._network_requests[req_id]["status"] = params.get("response", {}).get("status")
                self._network_requests[req_id]["responseHeaders"] = params.get("response", {}).get("headers", {})
                self._network_requests[req_id]["mimeType"] = params.get("response", {}).get("mimeType")

    async def send(self, method, params=None):
        self._cmd_id += 1
        cmd_id = self._cmd_id
        fut = asyncio.get_event_loop().create_future()
        self._pending[cmd_id] = fut
        await self.ws.send(json.dumps({"id": cmd_id, "method": method, "params": params or {}}))
        result = await asyncio.wait_for(fut, timeout=30)
        if "error" in result:
            raise RuntimeError(f"CDP error: {result['error']}")
        return result.get("result", {})

    # ── Navigation ────────────────────────────

    async def navigate(self, url: str, wait_ms=5000):
        await self.send("Page.enable")
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(wait_ms / 1000)
        return await self.eval("location.href")

    async def reload(self):
        await self.send("Page.reload")
        await asyncio.sleep(2)

    # ── JS execution ──────────────────────────

    async def eval(self, expression: str, await_promise=False):
        result = await self.send("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": await_promise,
            "returnByValue": True,
        })
        val = result.get("result", {})
        if val.get("type") == "undefined":
            return None
        return val.get("value")

    async def eval_async(self, expression: str):
        """Run async JS, automatically awaiting the Promise."""
        return await self.eval(expression, await_promise=True)

    # ── DOM operations ────────────────────────

    async def get_html(self):
        return await self.eval("document.documentElement.outerHTML")

    async def get_text(self):
        return await self.eval("document.body.innerText")

    async def get_title(self):
        return await self.eval("document.title")

    async def query(self, selector: str, attr=None):
        """Get an element's attribute or text."""
        if attr:
            return await self.eval(
                f"document.querySelector({json.dumps(selector)})?.{attr}"
            )
        return await self.eval(
            f"document.querySelector({json.dumps(selector)})?.innerText"
        )

    async def query_all(self, selector: str, attr="innerText"):
        return await self.eval(
            f"[...document.querySelectorAll({json.dumps(selector)})].map(e => e.{attr})"
        )

    async def wait_for_selector(self, selector: str, timeout=10):
        """Wait for an element to appear."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            found = await self.eval(f"!!document.querySelector({json.dumps(selector)})")
            if found:
                return True
            await asyncio.sleep(0.5)
        raise TimeoutError(f"Timed out waiting for {selector}")

    # ── Interaction ───────────────────────────

    async def click(self, selector: str):
        await self.eval(f"document.querySelector({json.dumps(selector)})?.click()")

    async def type_text(self, selector: str, text: str, clear=True):
        if clear:
            await self.eval(
                f"const el = document.querySelector({json.dumps(selector)}); "
                f"if(el) {{ el.focus(); el.value = ''; }}"
            )
        await self.send("Input.dispatchKeyEvent", {"type": "char", "text": ""})
        # Type character by character via CDP Input
        await self.eval(
            f"const el = document.querySelector({json.dumps(selector)}); "
            f"if(el) {{ el.focus(); el.value = {json.dumps(text)}; "
            f"el.dispatchEvent(new Event('input', {{bubbles:true}})); "
            f"el.dispatchEvent(new Event('change', {{bubbles:true}})); }}"
        )

    async def scroll(self, x=0, y=500):
        await self.eval(f"window.scrollBy({x}, {y})")

    async def scroll_to_bottom(self):
        await self.eval("window.scrollTo(0, document.body.scrollHeight)")

    # ── Screenshots ───────────────────────────

    async def screenshot(self, path: str = None, full_page=False):
        params = {"format": "png"}
        if full_page:
            metrics = await self.send("Page.getLayoutMetrics")
            h = int(metrics.get("cssContentSize", {}).get("height", 1080))
            w = int(metrics.get("cssContentSize", {}).get("width", 1920))
            await self.send("Emulation.setDeviceMetricsOverride", {
                "width": w, "height": h, "deviceScaleFactor": 1, "mobile": False
            })
            params["clip"] = {"x": 0, "y": 0, "width": w, "height": h, "scale": 1}
        result = await self.send("Page.captureScreenshot", params)
        data = base64.b64decode(result["data"])
        if path:
            Path(path).write_bytes(data)
            return path
        return data

    # ── Network monitoring ────────────────────

    async def capture_network(self, duration=10, url_filter=None):
        """Listen for network requests for `duration` seconds; return the request list."""
        self._network_requests.clear()
        await self.send("Network.enable")
        await asyncio.sleep(duration)
        reqs = list(self._network_requests.values())
        if url_filter:
            reqs = [r for r in reqs if url_filter in (r.get("url") or "")]
        return reqs

    async def get_response_body(self, request_id: str):
        try:
            result = await self.send("Network.getResponseBody", {"requestId": request_id})
            body = result.get("body", "")
            if result.get("base64Encoded"):
                body = base64.b64decode(body).decode("utf-8", errors="replace")
            return body
        except Exception:
            return None

    # ── Cookies / Storage ─────────────────────

    async def get_cookies(self, url=None):
        params = {"urls": [url]} if url else {}
        result = await self.send("Network.getCookies", params)
        return result.get("cookies", [])

    async def set_cookie(self, name, value, domain, path="/"):
        await self.send("Network.setCookie", {
            "name": name, "value": value, "domain": domain, "path": path
        })

    async def get_local_storage(self):
        return await self.eval(
            "Object.fromEntries(Object.entries(localStorage))"
        )

    # ── Headers / spoofing ────────────────────

    async def set_extra_headers(self, headers: dict):
        await self.send("Network.setExtraHTTPHeaders", {"headers": headers})

    async def set_user_agent(self, ua: str):
        await self.send("Network.setUserAgentOverride", {"userAgent": ua})


# ──────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────

import urllib.parse


async def _cli(cmd, args):
    if cmd == "start":
        launch_chrome()
        v = get_version()
        print(f"Chrome {v['Browser']} started, CDP: {CDP_BASE}")
        return

    if cmd == "stop":
        stop_chrome()
        return

    if cmd == "status":
        try:
            v = get_version()
            tabs = get_tabs()
            print(f"✅ Chrome {v['Browser']} running")
            print(f"   CDP: {CDP_BASE}")
            print(f"   Tabs: {len(tabs)}")
            for t in tabs:
                print(f"   - {t.get('title', 'untitled')}: {t.get('url', '')}")
        except Exception:
            print("❌ Chrome not running")
        return

    if cmd == "tabs":
        tabs = get_tabs()
        for i, t in enumerate(tabs):
            print(f"[{i}] {t.get('title', 'untitled')}: {t.get('url', '')}")
        return

    # The remaining commands require a CDP connection
    try:
        tabs = get_tabs()
    except Exception:
        print("Chrome not running, starting it...")
        launch_chrome()
        tabs = get_tabs()

    # Pick the first non-chrome:// tab, or just the first one
    tab = next((t for t in tabs if not t.get("url", "").startswith("chrome")), tabs[0])
    ws_url = tab["webSocketDebuggerUrl"]

    async with CDPClient(ws_url) as cdp:
        if cmd == "navigate":
            url = args[0]
            wait = float(args[1]) if len(args) > 1 else 5
            result = await cdp.navigate(url, wait_ms=int(wait * 1000))
            print(f"✅ Navigated to: {result}")

        elif cmd == "screenshot":
            path = args[0] if args else "/tmp/screenshot.png"
            full = "--full" in args
            await cdp.screenshot(path, full_page=full)
            print(f"✅ Screenshot saved to: {path}")

        elif cmd == "html":
            html = await cdp.get_html()
            print(html)

        elif cmd == "text":
            text = await cdp.get_text()
            print(text)

        elif cmd == "title":
            print(await cdp.get_title())

        elif cmd == "eval":
            expr = args[0]
            result = await cdp.eval(expr)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        elif cmd == "network":
            await cdp.send("Network.enable")
            duration = float(args[0]) if args else 10
            url_filter = args[1] if len(args) > 1 else None
            print(f"⏳ Listening for network requests for {duration}s..." + (f" filter: {url_filter}" if url_filter else ""))
            cdp._network_requests.clear()
            await asyncio.sleep(duration)
            reqs = list(cdp._network_requests.values())
            if url_filter:
                reqs = [r for r in reqs if url_filter in (r.get("url") or "")]
            print(f"\n📡 Captured {len(reqs)} requests:")
            for r in reqs:
                print(f"  [{r.get('method','?')}] {r.get('type','?')} {r.get('url','')}")
                if r.get("postData"):
                    print(f"    Body: {r['postData'][:200]}")
                if r.get("status"):
                    print(f"    Status: {r['status']} | MIME: {r.get('mimeType','')}")

        elif cmd == "click":
            selector = args[0]
            await cdp.click(selector)
            print(f"✅ Clicked: {selector}")

        elif cmd == "type":
            selector, text = args[0], args[1]
            await cdp.type_text(selector, text)
            print(f"✅ Typed: {text}")

        elif cmd == "scroll":
            x = int(args[0]) if args else 0
            y = int(args[1]) if len(args) > 1 else 500
            await cdp.scroll(x, y)
            print(f"✅ Scrolled: ({x}, {y})")

        elif cmd == "wait":
            selector = args[0]
            timeout = float(args[1]) if len(args) > 1 else 10
            await cdp.wait_for_selector(selector, timeout)
            print(f"✅ Element appeared: {selector}")

        elif cmd == "cookies":
            cookies = await cdp.get_cookies()
            print(json.dumps(cookies, ensure_ascii=False, indent=2))

        elif cmd == "query":
            selector = args[0]
            attr = args[1] if len(args) > 1 else None
            result = await cdp.query(selector, attr)
            print(result)

        elif cmd == "query-all":
            selector = args[0]
            attr = args[1] if len(args) > 1 else "innerText"
            result = await cdp.query_all(selector, attr)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        else:
            print(f"Unknown command: {cmd}")
            print_help()


def print_help():
    print("""
CDP Browser Controller
Usage: python3 cdp.py <command> [args]

Commands:
  start                     Launch Chrome
  stop                      Stop Chrome
  status                    Show status
  tabs                      List all tabs
  navigate <url> [wait_s]   Navigate to a URL
  screenshot [path] [--full] Take a screenshot
  html                      Get the page HTML
  text                      Get the page plain text
  title                     Get the page title
  eval <js_expr>            Run JS
  network [seconds] [filter] Listen for network requests
  click <selector>          Click an element
  type <selector> <text>    Type text
  scroll [x] [y]            Scroll the page
  wait <selector> [timeout]  Wait for an element
  cookies                   Get cookies
  query <selector> [attr]   Query a single element
  query-all <selector> [attr] Query all elements
""")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print_help()
        sys.exit(0)

    cmd = sys.argv[1]
    args = sys.argv[2:]
    asyncio.run(_cli(cmd, args))
