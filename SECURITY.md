# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report them privately via
[GitHub Security Advisories](https://github.com/bug-board/bugboard-js/security/advisories/new)
for this repository. Include as much detail as you can: affected version, a proof of concept
or reproduction steps, and the impact you foresee.

You should receive an acknowledgement within 72 hours. We'll keep you informed as we triage,
fix, and disclose — and we'll credit you in the advisory unless you prefer otherwise.

## Key-handling guidance for SDK users

- A **signing secret** (`bb_sec_…`) belongs on servers only — read it from the environment, never
  hardcode it, and never ship it in anything that reaches a browser. The SDK only ever uses it to
  compute request signatures; it is never transmitted or logged.
- A **publishable key** (`bb_pub_…`) is public by design and write-only. Contain a leak's blast
  radius with a dedicated key per app, an origin allow-list, sampling, and your project quota —
  and revoke/rotate keys instantly from **Settings → API Keys**.
- For sensitive payloads, enable **payload encryption** (`encryptionPublicKey`) so request
  bodies are opaque in transit — including in the browser network tab.
