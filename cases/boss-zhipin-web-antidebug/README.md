# Case index — Boss Zhipin (web)

Two halves, both verified live. Start with `case.md`.

## Headline results (verified)
- **Anti-debug**: defeated end-to-end via Mode-C file replacement (zero injection). A name-stable regex
  patch set covering all 7 detection layers neuters the whole stack across every webpack bundle. **Bypass, never flip** a detector gate —
  flipping routes into the punishment branch (memory bomb).
- **Token `__zp_stoken__`**: you CAN generate it and use it from plain Python. The algorithm was never
  the blocker — the blocker was **cookie encoding**: the token has `+`/`/`; the browser stores it
  URL-encoded; storing it raw makes the server URL-decode `+`→space → corrupted → `code:37`. Fix:
  `encodeURIComponent` / `quote(safe='')`.
- **Seed**: server-issued in the `code:37` response, cached in `localStorage['passport_config']`,
  reusable ~5× before a fresh 37 is needed. No client-side seed generation.

## Files
| File | What |
|---|---|
| [`case.md`](case.md) | Main case study (anti-debug half), 7-phase method, reproduce steps |
| [`detection-points.md`](detection-points.md) | The 7 anti-debug layers + principles |
| [`patch-set.md`](patch-set.md) | The universal patches (all 7 layers), annotated + hit counts |
| [`source-excerpts.md`](source-excerpts.md) | Real bundle source of every detector (ground truth) |
| [`patch-all.js`](patch-all.js) | Runnable all-bundle anti-debug patcher |
| [`token-stoken-and-cookie-encoding.md`](token-stoken-and-cookie-encoding.md) | **Token half**: z()/seed/cookie-encoding, fully verified |
| [`rpc3-inject.js`](rpc3-inject.js) / [`rpc3-backend.py`](rpc3-backend.py) | Working external mode: expose ABC + RPC + Python (URL-encode) → data |

## Tools this case drove into the framework
- `skills/web/js-trace-engine`: Mode-C `replace --rules` (transport rewrite, no-inject), `verify`,
  and **`reqdiff`** (byte-diff the browser's request vs your replay — the tool that would have caught
  the cookie-encoding bug in one shot instead of ~30 rounds).
- Playbook `brain/playbooks/web-antibot.md`: the "Replay gotchas" section (cookie encoding =
  check-don't-assume + byte-diff first) and the bypass-never-flip / file-replace-the-obfuscated-source
  lessons. `AGENTS.md` rule #3 (no guessing) was strengthened because of this case.

## Methodology post-mortem (read this)
The investigation took far longer than it should have. The lessons, now encoded in the framework:
1. **"browser works, replay doesn't" → byte-diff the two requests FIRST.** Don't theorize. (`reqdiff`)
2. **Capture by file-replacing the obfuscated source + appending a wrapper** — JS prototype hooks get
   defeated by JSVMP obfuscation and call-before-hook races; patch the bundle the call actually lives in.
3. **Never state a cause you haven't isolated.** ≥3 reproductions for anything stochastic.
