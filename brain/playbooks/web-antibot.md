# Playbook — Web anti-bot / sign-param reversing (standard flow)

The SOP for reversing a web anti-bot parameter (`__zp_stoken__`, `_px3`, `acw_sc__v2`, sign/sig,
x-*-token…). Three phases, in order. Do NOT skip phase 1 — re-deriving what an expert already
published is wasted effort and risk.

## Phase 0 — Coverage check (always first; AGENTS.md rule #1)
`grep -niE '<host>|<cookie>|<param>' catalog/targets.yaml TARGETS.md catalog/web.yaml` and
`grep -rli '<name>' skills/ cases/`. If covered → route to the existing asset. If covered by a
*different angle* than what's asked (e.g. existing = RPC bypass, ask = defeat anti-debug), it's not
redundant — proceed, and note the gap you're filling.

## Phase 1 — Stand on giants: open-source + technical writeups
Before touching the target, harvest what's already known. Cheapest, highest-leverage step.
- **Open-source**: search the user's own account first (warterbili/…), then GitHub by host/param.
- **Writeups**: kanxue / CSDN / 看雪 / Medium / blog posts for the EXACT param. Extract:
  obfuscation type (OB / control-flow-flattening / JSVMP), anti-debug shape, algorithm chain,
  and what others did to defeat each. Record the concrete facts (state var names, function names,
  script URL) — they orient the whole job.
- Output: a one-paragraph "known protection profile" before you run anything.

## Phase 2 — See the actual situation (verify, don't trust)
Writeups drift; versions change. Confirm against the live target.
- Pull the current security JS (browser devtools / mitm / `cdp-browser`). Diff against the writeup.
- Fingerprint: is it still CFF? same state var? same anti-debug? new layers?
- Capture a real request+response sample (the oracle's ground truth).
- Output: confirmed protection profile + a saved copy of the live script + a real sample.

## Phase 3 — Plan: map each protection to a weapon, then execute the ladder
For every protection mechanism, name the exact tool that defeats it. Then run the escalation
ladder (see `skills/web/js-trace-engine` + `references/architecture.md`) cheapest-first.

| protection | weapon |
|---|---|
| timing anti-debug (elapsed-time delta) | `--freeze-clock` (prelude monotonic clock) |
| `debugger` / `Function('debugger')` traps | `--anti-debug` (anti-debug.js strip) |
| self-defending toString/regex | anti-debug.js defang + `Function.prototype.toString` redirect |
| control-flow flattening / JSVMP | L3a `vmtrace`/`auto` (dispatch-loop trace → state/opcode sequence) |
| runtime eval/Function code-gen | L1+L2 recursive instrumentation |
| heavy env fingerprinting | env-supplement-proxy (`--env`) or real browser (Mode A/C) |
| obfuscated identifiers | `lift` (trace-augmented LLM rename) |
| console flood + `console.clear` loop | Mode-C `replace --rules` (neuter the clear-wrapper defs, not bare `.clear()`) |
| memory bomb / OOM (`Array(1eN).fill`/`repeat(1eN)`) | Mode-C rule-pack `1eN→1` or `--anti-debug` (shrinks numeric bombs) |
| redirect-to-home eject (`history.back`/`window.open("","_self")`) | Mode-C: blank the eject fn (`fn(){return;`) — see "bypass never flip" |
| native-method-tamper detector (`[native code]`/instanceof) | Mode-C file replacement (NOT runtime hooks — hooks trip it) |
| multi-bundle anti-debug (same logic per webpack chunk) | one name-stable rule-pack over ALL `*.js` (shared class-method names) |
| **verification** | `tools/oracle.py replay` (param→200) AND `cli.js verify` (anti-debug neutered) |

Run order: coverage → harvest → confirm → `auto` (cheap) → escalate on trigger → `lift` → replay.
Terminal success = oracle passes, not "I saw the trace".

## Replay gotchas — when "browser works, my replay returns an error" (read before theorizing)

The algorithm is usually NOT the problem. Before reversing anything, **byte-diff the browser's real
request against yours** — capture the working request (CDP `Network.requestWillBeSent*` / devtools) and
diff method, URL, every header, and **every cookie value**. The difference is almost always transport,
not crypto. Driven by `cases/boss-zhipin-web-antidebug` (a cookie-encoding bug cost ~30 rounds of wrong
theories because I never diffed the two cookies):

- **Cookie value encoding — CHECK, don't assume.** The browser may store/send a cookie value
  *differently* than the raw value you'd set. This is NOT universal — many sites need no encoding —
  so don't blindly encode; **diff your cookie value against the browser's and match whatever it does.**
  The failure mode to watch for: a token containing `+` `/` `=`. Some sites' `Cookie.set` URL-encodes it
  (`+`→`%2B`, `/`→`%2F`); if you store it raw, the server's URL-decode turns `+`→**space** → corrupted
  token → anomaly code (this is exactly what bit `cases/boss-zhipin-web-antidebug` — fix there was
  `encodeURIComponent`/`quote(tok, safe='')`). Symptom: browser's cookie ends `…%2F`, yours `…/`. A
  one-line `===` of the two values catches it — but only encode if the browser actually did.
- **The token is a non-deterministic, server-seeded value.** If `gen(seed,ts)` returns a different output
  each call, the server can't recompute it — it verifies a signature from a **server-issued seed**
  (delivered in an error/challenge response, often cached in `localStorage`). You usually can't
  pure-algo a seed; you obtain it from the challenge and the seed may be **reuse-limited** (e.g. ~N uses
  then re-challenge).
- **Headers the SPA adds vs raw fetch.** The app's own requests carry interceptor headers (e.g.
  `zp_token`/`traceId`) your raw `fetch` lacks — but check whether they're actually *required* (often the
  cookie alone suffices). Diff, don't assume.
- **Capture the RIGHT thing.** JS-prototype hooks get defeated by JSVMP/obfuscation and by timing; the
  reliable capture is **file-replacing the obfuscated source itself and appending a wrapper** (same
  realm → beats obfuscation + the call-before-hook race). Patch the bundle the call actually lives in.

## Phase 3b — Live anti-debug BYPASS (clean debug environment, not param extraction)

When the goal is a debuggable session (DevTools doesn't get punished) rather than a reproduced param,
use **Mode-C source replacement** (`cli.js replace`). Hard-won rules (see `cases/boss-zhipin-web-antidebug`):

- **Bypass, never flip.** Blank a detector function (`function Bm(){return;`), NEVER invert its gate
  (`if(n&&i&&a&&o)`→`if(false)`). The `else` branch is usually the PUNISHMENT path (memory bomb /
  `method_modify` report) — flipping the gate self-reports as an attacker and detonates it.
- **File replacement > runtime injection.** `--no-inject`. Overriding `Array`/`rAF`/timing/native
  methods breaks SPA frameworks (clicks die) and trips native-tamper detectors. Patch the source.
- **One rule-pack covers all bundles.** Anti-debug is duplicated per webpack chunk with per-bundle
  minified names, but class-method names (e.g. `XCID`/`XCIT`) are shared — match those + structural
  shapes, intercept every `*.js`. `--rules boss|web-antidebug|<file>`.
- **Transport: local-server redirect, not `fulfillRequest`.** A big body OOMs CDP. `cli.js replace`
  re-fetches + transforms + serves via `continueRequest({url})`; it also sets `setCacheDisabled`
  (cached bundles silently bypass the patch). Stays armed so SPA re-fetches keep getting patched.
- **clear-flood is surgical.** Neuter wrapper DEFINITIONS (`()=>X.clear()`, `function(){return
  X.clear()}`, the log/table/clear tuple incl. the bare comma-expr tail), never bare `X.clear()`.
- **Verify, don't assume.** `cli.js verify --port <p> --match <host> --selector <css>` picks the real
  page target (not the devtools:// frontend) and asserts 0 clears / no redirect / not blurred / rendered.

```bash
cd skills/web/js-trace-engine
node cli.js replace --url <job-url> --port 9540 --rules boss --no-inject --match '*static.<host>*.js*'
node cli.js verify  --port 9540 --match <host> --selector 'a[href*=...]'
```

For a token whose value embeds live entropy (anti-replay, e.g. `__zp_stoken__`), byte-for-byte E2E
needs a live challenge seed; the offline bar is **determinism under frozen entropy** (`run-abc … freeze`
→ identical output) + version-header parity with the live cookie. Triggering the server challenge to
get a seed is destructive to a healthy session — treat it as a separate, opt-in thread.

> Authorized targets only (SECURITY.md). Anti-debug/algorithm RE is legitimate; scraping PII or
> automating actions on a third party's platform is the human's call, not the tool's.
