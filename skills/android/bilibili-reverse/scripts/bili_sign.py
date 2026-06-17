"""
bili_sign.py
============
Bilibili APP-API `sign` algorithm (recovered by reverse-engineering libbili.so).

The `sign` field is an MD5 anti-tamper signature on almost every Bilibili Android
API request. See references/app-api-sign.md for the full native chain.

Usage:
    from bili_sign import make_sign, sign_params

    sign = make_sign({"ts": "1234", "appkey": "...", ...})

    params = {"ts": "1234", "appkey": "...", ...}
    signed = sign_params(params)
    # -> {"ts": "1234", "appkey": "...", ..., "sign": "xxxx..."}
"""

import hashlib
from urllib.parse import quote


# ── appSecret ────────────────────────────────────────────────────────────
# PUBLIC reverse-engineering knowledge (not personal data).
# libbili.so stores the secret as 4 uint32 words (read by hook_appsecret.js
# from FUN_00118ff0 args[3]) instead of a string, to defeat `strings`/grep.
# Expanded: "560c52ccd288fed045859ed18bffd973"
_SECRET_UINT32 = [0x560C52CC, 0xD288FED0, 0x45859ED1, 0x8BFFD973]


def make_sign(params: dict) -> str:
    """
    Compute the Bilibili request `sign`.

    Native recovery path (libbili.so):
      FUN_00109050 -> FUN_0011629c -> FUN_001162a8 (OLLVM)
        |- FUN_00117de4 : serialize SortedMap -> "key=url_encoded_val&..."
        |- FUN_0011605c : select appSecret by appkey/version (4x uint32)
        '- FUN_00118ff0 : MD5
             MD5_Update(sorted_params)
             for i in 0..3: MD5_Update("%08x" % secret[i])   # DAT_001d8844 = "%08x"
             MD5_Final -> "%02x" * 16                          # DAT_001d8cbc = "%02x"

    Args:
        params: request params (raw values; URL-encoding is done here).

    Returns:
        32-char lowercase hex sign.
    """
    # Step 1: sort by key, URL-encode each value, join "k=v&..."
    # The native serializer percent-encodes non-ASCII / special chars,
    # e.g. message=哈哈 -> %E5%93%88%E5%93%88, statistics={...} -> %7B...%7D
    sorted_params = "&".join(
        f"{k}={quote(str(v), safe='')}"
        for k, v in sorted(params.items())
    )

    # Step 2: MD5 streaming (FUN_00118ff0)
    ctx = hashlib.md5()
    ctx.update(sorted_params.encode("utf-8"))          # MD5_Update(sorted_params)

    for v in _SECRET_UINT32:                            # 4 iterations
        ctx.update(("%08x" % v).encode("utf-8"))        # MD5_Update("%08x" % word)

    return ctx.hexdigest()                              # MD5_Final + "%02x" * 16


def sign_params(params: dict) -> dict:
    """Return a new dict with the `sign` field added (does not mutate input)."""
    result = dict(params)
    result["sign"] = make_sign(params)
    return result


# ── Self-test ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Algorithm validation. The params below are a DESENSITIZED template:
    # personal fields (access_key, oid, track_id, container_uuid) are
    # placeholders, so this self-test only checks that make_sign runs and is
    # deterministic. To validate against a real capture, drop in the exact
    # captured params and compare against the captured `sign`.
    sample = {
        "access_key":      "<ACCESS_KEY>",
        "appkey":          "1d8b6e7d45233436",
        "build":           "8830500",
        "c_locale":        "zh-Hans_CN",
        "channel":         "html5_search_google",
        "container_uuid":  "<CONTAINER_UUID>",
        "disable_rcmd":    "0",
        "message":         "test",
        "mobi_app":        "android",
        "oid":             "116xxxxxxxxxxxx",
        "platform":        "android",
        "s_locale":        "zh-Hans_CN",
        "track_id":        "",
        "ts":              "1700000000",
        "type":            "1",
    }
    print("sign =", make_sign(sample))
    assert make_sign(sample) == make_sign(sample), "sign must be deterministic"
    print("OK (deterministic). Replace placeholders with a real capture to verify.")
