# Security Policy

auto_reverse is offensive-security and reverse-engineering tooling. This policy covers
**two distinct concerns**: how to use the project lawfully, and how to report a
vulnerability *in the project itself*.

## Acceptable use

The capabilities here (fuzzers, scanners, exploitation/C2 integrations, anti-bot
bypass, instrumentation, packer unpacking) are powerful and easily misused. By using
auto_reverse you agree to use it **only** against systems you own or are explicitly
authorized to test:

- authorized security research,
- penetration-testing engagements with a signed scope,
- Capture-The-Flag (CTF) competitions,
- interoperability and compatibility research,
- defensive and detection-engineering work.

You are solely responsible for complying with every law and contractual term that
applies to your target. The maintainers accept **no liability** for misuse.

Built-in guardrails (see [the brain](../brain/SKILL.md)):

- The orchestrator **desensitizes** by policy — real credentials, tokens, and PII must
  never be written into reports or case records; use placeholders.
- The orchestrator **stops and asks for a human** when a target appears to be for
  unauthorized or illegal use.

Do **not** open public issues that contain real credentials, private keys, customer
data, or unredacted captures of third-party traffic.

## Reporting a vulnerability in auto_reverse

If you find a security issue in this project's own code — for example, the `setup`
scripts, `fetch.py`/`doctor.py`, an adapter, or a bundled skill that could compromise
the host running it (arbitrary code execution, path traversal, unsafe download, secret
leakage) — please report it **privately**:

1. Preferred: open a [GitHub Security Advisory](https://docs.github.com/code-security/security-advisories/guides/privately-reporting-a-security-vulnerability)
   on this repository (**Security → Report a vulnerability**).
2. Alternatively, email the maintainers (see the repository profile) with a clear
   subject line beginning `SECURITY:`.

Please include: affected file/version, a description, reproduction steps, and impact.
**Do not** open a public issue for an undisclosed vulnerability.

### What to expect

- We aim to acknowledge a report within **5 business days**.
- We will work with you on a fix and a coordinated disclosure timeline.
- We credit reporters in the release notes unless you ask to remain anonymous.

## Supported versions

This project is pre-1.0 and moves fast. Only the latest `main` is supported; please
reproduce any report against the current `main` before filing.
