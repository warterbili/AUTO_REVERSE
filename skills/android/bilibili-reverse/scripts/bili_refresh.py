"""
bili_refresh.py
===============
access_key auto-refresh module.

Calls Bilibili's OAuth2 refresh_token endpoint to exchange for a new
access_key + refresh_token. Reuses the sign algorithm from bili_sign.py.
See references/access-key-refresh.md.

Both tokens ROTATE on every refresh — you MUST persist the new refresh_token
or you lose the ability to refresh (forced re-login).

Usage:
    from bili_refresh import refresh_access_key

    new_tokens = refresh_access_key(access_key, refresh_token, buvid)
    # {"access_key": "...", "refresh_token": "...", "mid": ..., "expires_in": ...}
"""

import time
import json
import pathlib
from urllib.parse import quote

import httpx

from bili_sign import sign_params

_REFRESH_URL = (
    "https://passport.bilibili.com/x/passport-login/oauth2/refresh_token"
)

# Public hardcoded BiliDroid UA (see bili_ticket.py note).
_UA = (
    "Mozilla/5.0 BiliDroid/8.83.0 (bbcallen@gmail.com) 8.83.0 "
    "os/android model/MI 9 mobi_app/android build/8830500 "
    "channel/html5_search_google innerVer/8830510 osVer/13 network/2"
)


def refresh_access_key(access_key: str, refresh_token: str, buvid: str) -> dict:
    """
    Refresh the access_key.

    Args:
        access_key: current access_key (sent even if expired).
        refresh_token: current refresh_token.
        buvid: device BUVID.

    Returns:
        {"access_key": str, "refresh_token": str, "mid": int, "expires_in": int}

    Raises:
        RuntimeError: when the endpoint returns a non-zero code.
    """
    ts = str(int(time.time()))

    params = {
        "access_key": access_key,
        "appkey": "1d8b6e7d45233436",
        "build": "8830500",
        "buvid": buvid,
        "c_locale": "zh-Hans_CN",
        "channel": "html5_search_google",
        "local_id": buvid,
        "mobi_app": "android",
        "platform": "android",
        "refresh_token": refresh_token,
        "s_locale": "zh-Hans_CN",
        "sts": ts,
    }
    signed = sign_params(params)

    # Build the body the SAME way it was signed (manual encode, raw bytes).
    body = "&".join(
        f"{k}={quote(str(v), safe='')}"
        for k, v in sorted(signed.items())
    )

    resp = httpx.post(
        _REFRESH_URL,
        content=body.encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": _UA,
        },
        timeout=10,
    )
    data = resp.json()

    if data.get("code") != 0:
        raise RuntimeError(
            f"refresh_token failed: code={data.get('code')}, "
            f"msg={data.get('message', '?')}"
        )

    token_info = data["data"]["token_info"]
    return {
        "access_key": token_info["access_token"],
        "refresh_token": token_info["refresh_token"],
        "mid": token_info["mid"],
        "expires_in": token_info["expires_in"],
    }


_CONFIG_PATH = pathlib.Path(__file__).parent / "config.json"


def refresh_and_save(config_path: pathlib.Path = _CONFIG_PATH) -> dict:
    """
    Read credentials from config.json, refresh, and write the new tokens back.

    Returns:
        The refresh result dict.
    """
    cfg = json.loads(config_path.read_text("utf-8"))

    rt = cfg.get("refresh_token", "")
    if not rt:
        raise RuntimeError(
            "No refresh_token in config.json. Capture it once via Frida "
            "(dump_tokens.js) or re-login to obtain it."
        )

    result = refresh_access_key(cfg["access_key"], rt, cfg["buvid"])

    # Persist the rotated tokens (REQUIRED — old refresh_token is now invalid).
    cfg["access_key"] = result["access_key"]
    cfg["refresh_token"] = result["refresh_token"]
    config_path.write_text(json.dumps(cfg, indent=4, ensure_ascii=False), "utf-8")

    return result


if __name__ == "__main__":
    print("Refreshing access_key ...")
    try:
        result = refresh_and_save()
        print("Refresh OK!")
        print(f"  mid          : {result['mid']}")
        print(f"  access_key   : {result['access_key'][:20]}...")
        print(f"  refresh_token: {result['refresh_token'][:20]}...")
        print(f"  expires_in   : {result['expires_in']}s "
              f"({result['expires_in'] // 86400} days)")
        print("\nWritten back to config.json")
    except RuntimeError as e:
        print(f"Refresh failed: {e}")
