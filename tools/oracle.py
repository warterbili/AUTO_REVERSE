#!/usr/bin/env python3
"""
oracle.py — Phase 7 verification harness. The thing that lets an autonomous run know it
actually succeeded instead of hallucinating: replay a (re-generated, signed) request and
judge the server's response against an expectation. Closes the loop.

  # verify a synthesized request was accepted:
  python tools/oracle.py replay --from workspace/<t>/06-synthesize/request.json \
        --expect-status 200 --expect-json-code 0

  # or inline:
  python tools/oracle.py replay --method POST --url https://api.example.com/v2/order \
        --header "x-sign: abc" --body '{"a":1}' --expect-status 200

request.json schema (what 06-synthesize should emit):
  {"method":"POST","url":"https://...","headers":{"x-sign":"..."},"body":"...",
   "expect":{"status":200,"json_code":0,"contains":"ok"}}

Exit code 0 = VERIFIED, 1 = REJECTED/failed — so a driver/agent can branch on it.
Zero third-party deps (urllib).
"""
import argparse
import json
import sys
import urllib.request
import urllib.error


def replay(method, url, headers, body, timeout=30):
    data = body.encode("utf-8") if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return None, {}, f"<request failed: {e}>"


def judge(status, text, exp):
    reasons = []
    ok = True
    if exp.get("status") is not None:
        good = status == exp["status"]
        ok &= good
        reasons.append(f"status {status} {'==' if good else '!='} {exp['status']}")
    if exp.get("json_code") is not None:
        try:
            code = json.loads(text).get("code")
            good = code == exp["json_code"]
            ok &= good
            reasons.append(f"json.code {code} {'==' if good else '!='} {exp['json_code']}")
        except Exception:
            ok = False
            reasons.append("json.code expected but body is not JSON")
    if exp.get("contains"):
        good = exp["contains"] in text
        ok &= good
        reasons.append(f"body {'contains' if good else 'MISSING'} {exp['contains']!r}")
    if not exp:
        # default: any 2xx is a pass
        ok = status is not None and 200 <= status < 300
        reasons.append(f"default 2xx check (status={status})")
    return ok, reasons


def main():
    ap = argparse.ArgumentParser(description="replay-and-verify oracle (Phase 7)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("replay", help="replay a request and judge the response")
    r.add_argument("--from", dest="src", help="request.json file")
    r.add_argument("--method", default="GET")
    r.add_argument("--url")
    r.add_argument("--header", action="append", default=[], help="'Name: value' (repeatable)")
    r.add_argument("--body", default="")
    r.add_argument("--expect-status", type=int)
    r.add_argument("--expect-json-code", type=int)
    r.add_argument("--expect-contains")
    args = ap.parse_args()

    if args.src:
        spec = json.load(open(args.src, encoding="utf-8"))
        method = spec.get("method", "GET"); url = spec["url"]
        headers = spec.get("headers", {}); body = spec.get("body", "")
        exp = spec.get("expect", {})
    else:
        if not args.url:
            print("oracle: --url or --from required", file=sys.stderr); sys.exit(2)
        method, url, body = args.method, args.url, args.body
        headers = {}
        for h in args.header:
            if ":" in h:
                k, v = h.split(":", 1); headers[k.strip()] = v.strip()
        exp = {}
    # CLI expectations override
    if args.expect_status is not None: exp["status"] = args.expect_status
    if args.expect_json_code is not None: exp["json_code"] = args.expect_json_code
    if args.expect_contains: exp["contains"] = args.expect_contains

    status, _hdr, text = replay(method, url, headers, body)
    ok, reasons = judge(status, text, exp)
    verdict = "VERIFIED ✓" if ok else "REJECTED ✗"
    print(f"[oracle] {verdict}  ({method} {url})")
    for r_ in reasons:
        print(f"    - {r_}")
    if not ok:
        print(f"    body[:200]: {text[:200]!r}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
