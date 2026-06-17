"""
Self-run capture for an anti-bot SDK and its collector traffic via CDP.

Generic, target-agnostic reverse-engineering tool: drives a real Chrome
(no webdriver fingerprint) to a target page, waits for the anti-bot SDK to
boot, then dumps the SDK .js plus any collector POST request/response bodies.

PerimeterX (px-cloud.net) is used as the default example of an anti-bot SDK,
but every target-specific value is a command-line argument.

Usage:
    python capture_sdk_via_cdp.py [N] \
        --url https://example.com/ \
        --sdk-domain client.px-cloud.net \
        --collector-path /api/v2/collector

  N                  number of capture batches (default 6)
  --url              page that activates the anti-bot SDK
  --domain           site domain used to pick the right tab (default: derived from --url)
  --sdk-domain       substring(s) that identify the SDK .js host (repeatable)
  --collector-path   substring(s) that identify the collector POST path (repeatable)

Run against an IP in the target's geo if the SDK is geo-gated.
"""

import argparse
import asyncio
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path
from urllib.parse import urlparse

import os
SKILL = os.environ.get("CDP_SKILL_DIR") or str(Path.home() / ".claude" / "skills" / "cdp-browser" / "scripts")
sys.path.insert(0, SKILL)
# Also import the local cdp.py (lives next to this script) so we can reuse
# its cross-platform Chrome auto-detection.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import CDPClient, CHROME_BIN  # noqa: E402

# Chrome binary auto-detected by cdp.py (Mac / Windows / Linux); set
# CHROME_BIN env var to override.
CHROME = CHROME_BIN
CDP_PORT = 9222


def launch_chrome(url: str, profile: Path) -> subprocess.Popen | None:
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=1)
        print(f"[*] Chrome already on :{CDP_PORT}")
        return None
    except Exception:
        pass
    profile.mkdir(parents=True, exist_ok=True)
    args = [
        CHROME,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        "--disable-blink-features=AutomationControlled",
        url,
    ]
    print("[*] Launching Chrome…")
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("Chrome did not start")


def get_target_tab(domain: str):
    data = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=3).read())
    for t in data:
        if t.get("type") == "page" and domain and domain in (t.get("url") or ""):
            return t
    for t in data:
        if t.get("type") == "page":
            return t
    raise RuntimeError("No tabs")


async def capture_once(cdp: CDPClient, batch_id: int, batch_dir: Path, cfg) -> dict:
    print(f"\n[batch {batch_id}] navigating…")
    seen: dict[str, dict] = {}

    orig = cdp._handle_event

    async def patched(msg):
        m = msg.get("method", "")
        p = msg.get("params", {})
        if m == "Network.requestWillBeSent":
            rid = p["requestId"]
            r = p.get("request", {})
            seen[rid] = {
                "url": r.get("url"),
                "method": r.get("method"),
                "headers": r.get("headers", {}),
                "postData": r.get("postData"),
                "type": p.get("type"),
                "ts": p.get("timestamp"),
            }
        elif m == "Network.responseReceived":
            rid = p["requestId"]
            r = p.get("response", {})
            if rid in seen:
                seen[rid]["status"] = r.get("status")
                seen[rid]["responseHeaders"] = r.get("headers", {})
        await orig(msg)
    cdp._handle_event = patched

    await cdp.send("Network.enable", {
        "maxTotalBufferSize": 100 * 1024 * 1024,
        "maxResourceBufferSize": 50 * 1024 * 1024,
    })
    await cdp.send("Network.clearBrowserCookies")
    await cdp.send("Network.clearBrowserCache")

    await cdp.send("Page.enable")
    await cdp.send("Page.navigate", {"url": cfg.url})

    print(f"[batch {batch_id}] waiting 14s for SDK collector...")
    await asyncio.sleep(14)

    sdk_req = None
    posts = []
    for rid, r in seen.items():
        url = r.get("url") or ""
        if any(m in url for m in cfg.sdk_domain) and ("init" in url or "main" in url or url.endswith(".js")):
            sdk_req = (rid, r)
        if r.get("method") == "POST" and any(p in url for p in cfg.collector_path):
            r["request_id"] = rid
            posts.append(r)

    print(f"[batch {batch_id}] sdk: {sdk_req is not None}; POSTs: {len(posts)}")

    if not posts:
        try:
            import base64
            batch_dir.mkdir(parents=True, exist_ok=True)
            shot = await cdp.send("Page.captureScreenshot", {"format": "png"})
            (batch_dir / "_failed_screenshot.png").write_bytes(base64.b64decode(shot["data"]))
        except Exception:
            pass

    batch_dir.mkdir(parents=True, exist_ok=True)

    if sdk_req:
        body = await cdp.get_response_body(sdk_req[0])
        if body:
            cfg.sdk_dir.mkdir(parents=True, exist_ok=True)
            # Filename derived from URL last segment
            url = sdk_req[1].get("url", "")
            name = url.split("/")[-1].split("?")[0] or "main.min.js"
            (cfg.sdk_dir / name).write_text(body, encoding="utf-8")
            print(f"[batch {batch_id}] saved SDK → {name} ({len(body)} chars)")

    posts.sort(key=lambda r: r.get("ts") or 0)
    for i, r in enumerate(posts[:3], 1):
        post = r.get("postData") or ""
        lines = [f"POST {r['url']}"]
        for k, v in (r.get("headers") or {}).items():
            lines.append(f"{k}: {v}")
        lines.append("")
        lines.append(post)
        (batch_dir / f"request_{i}.txt").write_text("\n".join(lines), encoding="utf-8")
        resp = await cdp.get_response_body(r["request_id"]) or ""
        (batch_dir / f"response_{i}.json").write_text(resp, encoding="utf-8")

    if posts:
        p1 = posts[0].get("postData") or ""
        def gp(n):
            m = re.search(rf"(?:^|&){re.escape(n)}=([^&]*)", p1)
            return urllib.parse.unquote_plus(m.group(1)) if m else None
        meta = {
            "batch_id": batch_id,
            "site": cfg.domain,
            "uuid": gp("uuid"),
            "tag": gp("tag"),
            "ft": gp("ft"),
            "app_id": gp("appId"),
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "collector_post_count": len(posts),
            "status_post_1": posts[0].get("status"),
            "status_post_2": posts[1].get("status") if len(posts) > 1 else None,
        }
        (batch_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta
    return {"batch_id": batch_id, "error": "no collector POST captured"}


def parse_args(argv):
    p = argparse.ArgumentParser(description="Capture an anti-bot SDK + collector traffic via CDP.")
    p.add_argument("batches", nargs="?", type=int, default=6, help="number of capture batches (default 6)")
    p.add_argument("--url", default="https://example.com/", help="page that activates the anti-bot SDK")
    p.add_argument("--domain", default=None, help="site domain for tab selection (default: derived from --url)")
    p.add_argument("--sdk-domain", action="append", default=None,
                   help="substring identifying the SDK .js host (repeatable). Default: client.px-cloud.net")
    p.add_argument("--collector-path", action="append", default=None,
                   help="substring identifying the collector POST path (repeatable). Default: /api/v2/collector")
    p.add_argument("--root", default=None, help="output workspace root")
    cfg = p.parse_args(argv)
    if cfg.domain is None:
        cfg.domain = urlparse(cfg.url).netloc
    if cfg.sdk_domain is None:
        cfg.sdk_domain = ["client.px-cloud.net"]
    if cfg.collector_path is None:
        cfg.collector_path = ["/api/v2/collector"]
    root = Path(os.environ.get("CAPTURE_ROOT") or cfg.root
                or str(Path(__file__).resolve().parent.parent / "capture_workspace"
                       / (cfg.domain or "target")))
    cfg.root = root
    cfg.sdk_dir = root / "sdk"
    cfg.samples = root / "samples"
    cfg.profile = root / "chrome_profile"
    return cfg


async def main(cfg):
    launch_chrome(cfg.url, cfg.profile)
    tab = get_target_tab(cfg.domain)
    print(f"[*] tab: {tab.get('url')}")

    async with CDPClient(tab["webSocketDebuggerUrl"]) as cdp:
        N = cfg.batches
        summary = []
        for i in range(1, N + 1):
            bd = cfg.samples / str(i)
            shutil.rmtree(bd, ignore_errors=True)
            meta = await capture_once(cdp, i, bd, cfg)
            summary.append(meta)
            if i < N:
                await asyncio.sleep(15)

        # SDK hash
        for sdk_file in cfg.sdk_dir.glob("*.js"):
            h = hashlib.sha256(sdk_file.read_bytes()).hexdigest()
            (cfg.sdk_dir / f"{sdk_file.name}.info.json").write_text(json.dumps({
                "sha256": h,
                "size": sdk_file.stat().st_size,
            }, indent=2), encoding="utf-8")
            print(f"[*] {sdk_file.name} sha256: {h}")
            for s in summary:
                if isinstance(s, dict) and "batch_id" in s and "error" not in s:
                    p = cfg.samples / str(s["batch_id"]) / "meta.json"
                    if p.exists():
                        m = json.loads(p.read_text(encoding="utf-8"))
                        m["sdk_sha256"] = h
                        p.write_text(json.dumps(m, indent=2), encoding="utf-8")

        print("\n────── SUMMARY ──────")
        for s in summary:
            print(json.dumps(s, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main(parse_args(sys.argv[1:])))
