"""
bili_comment.py
===============
Worked end-to-end example: post a Bilibili comment via /x/v2/reply/add.

Builds the full request-header set + body params, signs the body, and sends
it as raw bytes whose encoding byte-for-byte matches the signed string.
See references/comment-api.md.

Usage:
    python bili_comment.py <oid> <message>
    python bili_comment.py 116xxxxxxxxxxxx "test comment"

All secrets are read from config.json (copy config.example.json first).
"""

import base64
import json
import sys
import time
import uuid
import secrets
import pathlib
from urllib.parse import quote

import httpx

from bili_sign import sign_params
from bili_ticket import gen_ticket, is_ticket_valid

_COMMENT_URL = "https://api.bilibili.com/x/v2/reply/add"
_CONFIG_PATH = pathlib.Path(__file__).parent / "config.json"


class BiliComment:
    """Bilibili comment sender."""

    def __init__(self, config_path=_CONFIG_PATH):
        self.config_path = pathlib.Path(config_path)
        self.cfg = json.loads(self.config_path.read_text("utf-8"))
        self.client = httpx.Client(http1=True, timeout=15)

    def _save_config(self):
        """Write config back (mainly to persist a refreshed ticket)."""
        self.config_path.write_text(
            json.dumps(self.cfg, indent=4, ensure_ascii=False), "utf-8"
        )

    def ensure_ticket(self) -> str:
        """Return a valid ticket value, refreshing it if necessary."""
        ticket_info = self.cfg.get("ticket", {})
        if not is_ticket_valid(ticket_info):
            print("[ticket] expired/empty, refreshing ...")
            ticket_info = gen_ticket()
            self.cfg["ticket"] = ticket_info
            self._save_config()
            print(f"[ticket] refreshed, ttl={ticket_info['ttl']}s")
        return ticket_info["value"]

    def _build_headers(self, ticket: str, body_len: int) -> dict:
        """Build the full request-header set."""
        dev = self.cfg["device"]
        fp = self.cfg["fingerprint"]
        mid = self.cfg["mid"]
        buvid = self.cfg["buvid"]

        # session_id: 8 random hex chars
        session_id = secrets.token_hex(4)

        # x-bili-trace-id: a fresh value per request (random bytes, Base64)
        trace_bytes = secrets.token_bytes(21)
        trace_id = base64.b64encode(trace_bytes).decode()

        ua = (
            f"Mozilla/5.0 BiliDroid/{dev['app_ver']} (bbcallen@gmail.com) "
            f"{dev['app_ver']} os/android model/{dev['model']} "
            f"mobi_app/{dev['mobi_app']} build/{dev['build']} "
            f"channel/{dev['channel']} innerVer/{dev['build']}10 "
            f"osVer/{dev['os_ver']} network/2"
        )

        return {
            "accept": "*/*",
            "accept-encoding": "gzip, deflate, br",
            "app-key": "android64",
            "bili-http-engine": "ignet",
            "buvid": buvid,
            "content-length": str(body_len),
            "content-type": "application/x-www-form-urlencoded; charset=utf-8",
            "env": "prod",
            "fp_local": fp["fp_local"],
            "fp_remote": fp["fp_remote"],
            "guestid": fp["guestid"],
            "session_id": session_id,
            "user-agent": ua,
            "x-bili-aurora-eid": fp["aurora_eid"],
            "x-bili-locale-bin": fp["locale_bin"],
            "x-bili-metadata-ip-region": "CN",
            "x-bili-metadata-legal-region": "CN",
            "x-bili-mid": str(mid),
            "x-bili-trace-id": trace_id,
            "x-bili-redirect": "1",
            "x-bili-ticket": ticket,
        }

    def _build_params(self, oid: str, message: str, type_: int = 1) -> dict:
        """Build the 24 body params (without sign)."""
        dev = self.cfg["device"]
        ts = int(time.time())

        statistics = json.dumps(
            {"appId": 1, "platform": 3, "version": dev["app_ver"], "abtest": ""},
            separators=(",", ":"),
            ensure_ascii=False,
        )

        return {
            "access_key": self.cfg["access_key"],
            "appkey": "1d8b6e7d45233436",
            "build": dev["build"],
            "c_locale": "zh-Hans_CN",
            "channel": dev["channel"],
            "container_uuid": str(uuid.uuid4()),
            "disable_rcmd": "0",
            "from_spmid": "tm.recommend.0.0",
            "has_vote_option": "false",
            "message": message,
            "mobi_app": dev["mobi_app"],
            "oid": str(oid),
            "ordering": "heat",
            "plat": "2",
            "platform": dev["platform"],
            "s_locale": "zh-Hans_CN",
            "scene": "main",
            "scm_action_id": secrets.token_hex(4).upper(),
            "spmid": "united.player-video-detail.0.0",
            "statistics": statistics,
            "sync_to_dynamic": "false",
            "track_id": "",
            "ts": str(ts),
            "type": str(type_),
        }

    def post_comment(self, oid: str, message: str, type_: int = 1) -> dict:
        """
        Send a comment.

        Args:
            oid: target video/content ID.
            message: comment text.
            type_: content type; 1 = video comment.

        Returns:
            The API response JSON dict.
        """
        # 1. Ensure a valid ticket.
        ticket = self.ensure_ticket()

        # 2. Build params and sign.
        params = self._build_params(oid, message, type_)
        signed = sign_params(params)

        # 3. Encode the body EXACTLY as it was signed (manual quote, raw bytes).
        body = "&".join(
            f"{k}={quote(str(v), safe='')}"
            for k, v in sorted(signed.items())
        )
        body_bytes = body.encode("utf-8")

        # 4. Build headers.
        headers = self._build_headers(ticket, len(body_bytes))

        # 5. Send.
        print(f"[comment] POST {_COMMENT_URL}")
        print(f"[comment] oid={oid}, message={message!r}, body_len={len(body_bytes)}")

        resp = self.client.post(_COMMENT_URL, content=body_bytes, headers=headers)
        result = resp.json()

        # 6. Handle the response.
        code = result.get("code", -1)
        if code == 0:
            rpid = result.get("data", {}).get("rpid", "?")
            print(f"[comment] OK! rpid={rpid}")
        elif code == -101:
            print(f"[comment] failed: code={code} (access_key expired, refresh it)")
        elif code == -111:
            print(f"[comment] failed: code={code} (csrf/sign check failed)")
        elif code == -412:
            print(f"[comment] failed: code={code} (request intercepted by risk control)")
        else:
            print(f"[comment] failed: code={code}, msg={result.get('message', '?')}")

        return result


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python bili_comment.py <oid> <message>")
        print('Example: python bili_comment.py 116xxxxxxxxxxxx "test comment"')
        sys.exit(1)

    oid = sys.argv[1]
    message = sys.argv[2]

    bc = BiliComment()
    result = bc.post_comment(oid, message)
    print(json.dumps(result, indent=2, ensure_ascii=False))
