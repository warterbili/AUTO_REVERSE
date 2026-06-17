"""
mitm_addon.py — mitmproxy addon that captures HTTP/HTTPS traffic to a JSONL file

Usage (invoked automatically by start_capture.py):
  mitmdump -s mitm_addon.py --set session_dir=/tmp/session -q
"""

import json
import time
import os
import re
import base64
from datetime import datetime
from pathlib import Path

from mitmproxy import ctx, http

# ── Encrypted-field detection rules ──────────────────────────────
ENCRYPT_PATTERNS = [
    (r"^[A-Za-z0-9+/]{40,}={0,2}$", "BASE64"),
    (r"^[0-9a-f]{32}$", "HEX-32 (MD5?)"),
    (r"^[0-9a-f]{40}$", "HEX-40 (SHA1?)"),
    (r"^[0-9a-f]{64}$", "HEX-64 (SHA256?)"),
    (r"^eyJ[A-Za-z0-9+/]", "JWT"),
    (r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", "UUID"),
]

AUTH_HEADER_PATTERNS = [
    "authorization", "x-auth", "x-token", "x-api-key", "x-sap",
    "token", "bearer", "session", "cookie", "x-access"
]

COLORS = {
    "reset": "\033[0m",
    "green": "\033[92m",
    "yellow": "\033[93m",
    "red": "\033[91m",
    "cyan": "\033[96m",
    "bold": "\033[1m",
    "dim": "\033[2m",
}


def c(color, text):
    return COLORS.get(color, "") + str(text) + COLORS["reset"]


def detect_encrypted(value: str):
    """Return (True, description) if the value looks encrypted/hashed."""
    if not value or len(value) < 16:
        return False, ""
    for pattern, label in ENCRYPT_PATTERNS:
        if re.match(pattern, value):
            return True, label
    return False, ""


def safe_decode_body(flow_message):
    """Safely decode the body; return (text, is_json, json_obj)."""
    try:
        content = flow_message.content
        if not content:
            return "", False, None

        text = content.decode("utf-8", errors="replace")

        # Try to parse JSON
        content_type = flow_message.headers.get("content-type", "")
        if "json" in content_type or text.strip().startswith(("{", "[")):
            try:
                return text, True, json.loads(text)
            except Exception:
                pass

        return text, False, None
    except Exception:
        return "", False, None


class CaptureAddon:
    def __init__(self):
        self.session_dir = None
        self.jsonl_file = None
        self.request_count = 0
        self.start_time = time.time()
        self.endpoints = {}  # path -> count

    def load(self, loader):
        loader.add_option("session_dir", str, "/tmp/mitm_session", "Session output directory")

    def running(self):
        self.session_dir = Path(ctx.options.session_dir)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.jsonl_path = self.session_dir / "captured.jsonl"
        self.jsonl_file = open(self.jsonl_path, "a", encoding="utf-8")
        print(c("green", f"\n[mitmproxy] Capturing to: {self.jsonl_path}"))

    def response(self, flow: http.HTTPFlow):
        """Record each response as it arrives."""
        try:
            self._process(flow)
        except Exception as e:
            print(c("red", f"[mitmproxy] Error processing flow: {e}"))

    def _process(self, flow: http.HTTPFlow):
        self.request_count += 1
        req = flow.request
        res = flow.response

        # ── Parse the request ──
        req_body_text, req_is_json, req_json = safe_decode_body(req)
        req_headers = dict(req.headers)

        # ── Parse the response ──
        res_body_text, res_is_json, res_json = safe_decode_body(res) if res else ("", False, None)
        res_headers = dict(res.headers) if res else {}
        status = res.status_code if res else 0

        # ── Detect auth headers ──
        auth_headers = {}
        encrypted_fields = []
        for k, v in req_headers.items():
            if any(p in k.lower() for p in AUTH_HEADER_PATTERNS):
                auth_headers[k] = v[:80] + ("..." if len(v) > 80 else "")
            is_enc, label = detect_encrypted(v)
            if is_enc:
                encrypted_fields.append({"location": f"header:{k}", "type": label, "preview": v[:40]})

        # ── Detect encrypted fields in the body ──
        if req_json and isinstance(req_json, dict):
            for k, v in req_json.items():
                if isinstance(v, str):
                    is_enc, label = detect_encrypted(v)
                    if is_enc:
                        encrypted_fields.append({"location": f"body:{k}", "type": label, "preview": v[:40]})

        # ── Tally endpoints ──
        endpoint_key = f"{req.method} {req.path.split('?')[0]}"
        self.endpoints[endpoint_key] = self.endpoints.get(endpoint_key, 0) + 1

        # ── Build the record ──
        record = {
            "timestamp": datetime.utcnow().isoformat(),
            "seq": self.request_count,
            "request": {
                "method": req.method,
                "host": req.host,
                "path": req.path,
                "url": req.pretty_url,
                "headers": req_headers,
                "body_text": req_body_text[:4096],
                "body_json": req_json,
            },
            "response": {
                "status": status,
                "headers": res_headers,
                "body_text": res_body_text[:8192],
                "body_json": res_json,
            },
            "analysis": {
                "auth_headers": auth_headers,
                "encrypted_fields": encrypted_fields,
            }
        }

        # ── Write JSONL ──
        self.jsonl_file.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.jsonl_file.flush()

        # ── Print in real time ──
        status_color = "green" if 200 <= status < 300 else "yellow" if 300 <= status < 400 else "red"
        enc_tag = c("yellow", f" [ENC:{len(encrypted_fields)}]") if encrypted_fields else ""
        auth_tag = c("cyan", " [AUTH]") if auth_headers else ""
        print(
            f"  {c('bold', f'#{self.request_count:3d}')} "
            f"{c('cyan', req.method):6s} "
            f"{c(status_color, str(status))} "
            f"{req.host}{req.path.split('?')[0][:60]}"
            f"{enc_tag}{auth_tag}"
        )

    def done(self):
        if self.jsonl_file:
            self.jsonl_file.close()
        elapsed = time.time() - self.start_time
        print(c("green", f"\n[mitmproxy] Session done. {self.request_count} requests in {elapsed:.0f}s"))
        print(c("dim", f"  Data: {self.session_dir / 'captured.jsonl'}"))


addons = [CaptureAddon()]
