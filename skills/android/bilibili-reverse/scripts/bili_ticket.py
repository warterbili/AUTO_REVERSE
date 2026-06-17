"""
bili_ticket.py
==============
x-bili-ticket refresh module.

Calls Bilibili's GenWebTicket endpoint to obtain/refresh the ticket (a JWT).
The Android client uses key_id="ec01" with HMAC key "Ezlc3tgtl".
See references/ticket.md for the full mechanism.

Usage:
    from bili_ticket import gen_ticket, is_ticket_valid

    ticket_info = gen_ticket()   # {"value": "eyJ...", "created_at": ..., "ttl": ...}
    still_ok = is_ticket_valid(ticket_info)
"""

import hmac
import hashlib
import time
import json

import httpx

# ── Android key material (PUBLIC reverse-engineering knowledge) ────────────
_KEY_ID = "ec01"
_HMAC_KEY = b"Ezlc3tgtl"

_TICKET_URL = (
    "https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket"
)

# Public, hardcoded BiliDroid User-Agent. The "bbcallen@gmail.com" string is
# Bilibili's public UA author tag (ijkplayer), NOT personal data.
_UA = (
    "Mozilla/5.0 BiliDroid/8.83.0 (bbcallen@gmail.com) 8.83.0 "
    "os/android model/MI 9 mobi_app/android build/8830500 "
    "channel/html5_search_google innerVer/8830510 osVer/13 network/2"
)


def gen_ticket() -> dict:
    """
    Request a fresh x-bili-ticket.

    Signing: hexsign = HMAC-SHA256(key="Ezlc3tgtl", msg="ts" + timestamp).

    Returns:
        {"value": str, "created_at": int, "ttl": int}

    Raises:
        RuntimeError: when the endpoint returns a non-zero code.
    """
    ts = int(time.time())
    hexsign = hmac.new(_HMAC_KEY, f"ts{ts}".encode(), hashlib.sha256).hexdigest()

    params = {
        "key_id": _KEY_ID,
        "hexsign": hexsign,
        "context[ts]": ts,
    }

    resp = httpx.post(
        _TICKET_URL, params=params, headers={"User-Agent": _UA}, timeout=10
    )
    data = resp.json()

    if data.get("code") != 0:
        raise RuntimeError(f"GenWebTicket failed: {data}")

    d = data["data"]
    return {
        "value": d["ticket"],
        "created_at": d["created_at"],
        "ttl": d["ttl"],
    }


def is_ticket_valid(ticket_info: dict, margin: int = 300) -> bool:
    """
    Check whether the ticket is still valid (refresh `margin` seconds early).

    Args:
        ticket_info: {"value": str, "created_at": int, "ttl": int}
        margin: seconds to refresh ahead of expiry (default 300 = 5 min).

    Returns:
        True if still usable.
    """
    if not ticket_info.get("value"):
        return False
    expire_at = ticket_info["created_at"] + ticket_info["ttl"]
    return time.time() < (expire_at - margin)


# ── CLI: run standalone to test ticket retrieval ───────────────────────────
if __name__ == "__main__":
    print("Requesting x-bili-ticket ...")
    info = gen_ticket()
    print(f"ticket : {info['value'][:50]}...")
    print(f"created: {info['created_at']}")
    print(f"ttl    : {info['ttl']}s ({info['ttl'] // 3600}h)")
    print(f"valid  : {is_ticket_valid(info)}")

    # Optionally write back to config.json (next to this script).
    import pathlib
    cfg_path = pathlib.Path(__file__).parent / "config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text("utf-8"))
        cfg["ticket"] = info
        cfg_path.write_text(json.dumps(cfg, indent=4, ensure_ascii=False), "utf-8")
        print(f"\nWrote ticket back to {cfg_path}")
