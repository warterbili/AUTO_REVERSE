"""Capture an anti-bot SDK's .js source via CDP (generic, target-agnostic).

Drives a real Chrome to a target page, then dumps every network resource whose
URL matches one of the SDK-host substrings (response body saved to sdk_cache/).
PerimeterX (px-cloud.net / px-cdn.net) is the default example of an anti-bot
SDK, but the URL and the match substrings are command-line arguments.

Usage:
    python fetch_sdk.py \
        --url https://example.com/login \
        --match px-cloud.net --match px-cdn.net --match perimeterx \
        --match /init.js --match /captcha/
"""
import argparse
import asyncio
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse
import websockets

# Reuse cross-platform Chrome auto-detection from cdp.py (sibling script).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import CHROME_BIN  # noqa: E402

CDP_PORT = 9223
# Cross-platform temp dir for the dedicated capture profile.
PROFILE = Path(tempfile.gettempdir()) / "anti-bot-sdk-capture"
SDK_DIR = Path(__file__).resolve().parent.parent / "sdk_cache"

# Default substrings that identify a (PerimeterX-style) anti-bot SDK resource.
DEFAULT_MATCHERS = [".px-cdn.net", "px-cloud.net", "perimeterx", "/captcha/", "/init.js"]


def launch():
    PROFILE.mkdir(parents=True, exist_ok=True)
    subprocess.Popen([CHROME_BIN, f"--remote-debugging-port={CDP_PORT}",
                      f"--user-data-dir={PROFILE}", "--no-first-run",
                      "--no-default-browser-check", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        time.sleep(0.5)
        try:
            urllib.request.urlopen(f"http://localhost:{CDP_PORT}/json", timeout=2); return
        except Exception:
            pass
    raise RuntimeError("Chrome timeout")


async def main(cfg):
    SDK_DIR.mkdir(parents=True, exist_ok=True)
    launch()
    tabs = json.loads(urllib.request.urlopen(f"http://localhost:{CDP_PORT}/json").read())
    ws_url = next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"]
    requests = {}
    sdk_finished = []

    async with websockets.connect(ws_url, max_size=80 * 1024 * 1024) as ws:
        cid = 0
        pending = {}

        async def listen():
            async for raw in ws:
                m = json.loads(raw)
                if "id" in m:
                    fut = pending.pop(m["id"], None)
                    if fut and not fut.done(): fut.set_result(m)
                else:
                    method = m.get("method", "")
                    p = m.get("params", {})
                    if method == "Network.requestWillBeSent":
                        rid = p.get("requestId")
                        url = p.get("request", {}).get("url", "")
                        requests[rid] = {"url": url}
                    elif method == "Network.responseReceived":
                        rid = p.get("requestId")
                        if rid in requests:
                            requests[rid]["status"] = p.get("response", {}).get("status")
                            requests[rid]["mime"] = p.get("response", {}).get("mimeType")
                    elif method == "Network.loadingFinished":
                        rid = p.get("requestId")
                        if rid in requests:
                            u = requests[rid].get("url", "")
                            if any(s in u for s in cfg.match):
                                sdk_finished.append(rid)

        async def send(method, params=None):
            nonlocal cid; cid += 1
            cur = cid
            fut = asyncio.get_event_loop().create_future()
            pending[cur] = fut
            await ws.send(json.dumps({"id": cur, "method": method, "params": params or {}}))
            r = await asyncio.wait_for(fut, timeout=30)
            if "error" in r: raise RuntimeError(r["error"])
            return r.get("result", {})

        listen_task = asyncio.create_task(listen())

        await send("Page.enable")
        await send("Network.enable")
        await send("Network.clearBrowserCookies")
        await send("Page.navigate", {"url": cfg.url})

        await asyncio.sleep(20)

        print(f"\nMatched SDK resources ({len(sdk_finished)}):")
        for rid in sdk_finished:
            r = requests[rid]
            print(f"  status={r.get('status')} mime={r.get('mime')}  url={r['url']}")
            try:
                resp = await send("Network.getResponseBody", {"requestId": rid})
                body = resp.get("body", "")
                if resp.get("base64Encoded"):
                    body = base64.b64decode(body)
                else:
                    body = body.encode("utf-8")
                # filename from url
                u = urlparse(r["url"])
                fname = (u.path.replace("/", "_").strip("_") or "root") + (".js" if "js" in (r.get("mime") or "") else ".bin")
                out = SDK_DIR / fname
                out.write_bytes(body)
                print(f"    -> saved {out.name} ({len(body)} bytes)")
            except Exception as e:
                print(f"    -> getResponseBody failed: {e}")

        # also dump all script URLs to logs/
        all_scripts = [r for r in requests.values()
                       if r.get("mime") and "javascript" in r["mime"]]
        scripts_log = SDK_DIR / "_all_scripts.txt"
        scripts_log.write_text("\n".join(f"{r.get('status')} {r['url']}" for r in all_scripts), encoding="utf-8")
        print(f"\n{len(all_scripts)} JS resources logged to {scripts_log.name}")

        listen_task.cancel()


def parse_args(argv):
    p = argparse.ArgumentParser(description="Capture an anti-bot SDK .js source via CDP.")
    p.add_argument("--url", default="https://example.com/login",
                   help="page that loads the anti-bot SDK")
    p.add_argument("--match", action="append", default=None,
                   help="URL substring identifying an SDK resource (repeatable). "
                        "Default: PerimeterX-style hosts/paths.")
    cfg = p.parse_args(argv)
    if cfg.match is None:
        cfg.match = list(DEFAULT_MATCHERS)
    return cfg


if __name__ == "__main__":
    asyncio.run(main(parse_args(sys.argv[1:])))
