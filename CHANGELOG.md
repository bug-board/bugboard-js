# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An `examples/` directory with a runnable, single-file example for every usage mode — browser
  publishable key, server HMAC, payload encryption, `beforeSend` scrubbing, serverless flushing,
  process-level handlers, sampling, testing, and typed severity helpers — plus a Next.js
  integration laid out as real files (server/client modules, route handler, error boundaries,
  `instrumentation.ts`) and a React error boundary. Linked from the README.
- Node 26 is now covered by CI alongside 20, 22 and 24. No source change was needed — the SDK
  runs on platform `fetch` and WebCrypto, so this records that the runtime is verified rather
  than assumed. The supported floor is unchanged at Node 20.

## [1.1.0] - 2026-07-20

### Added

- Reports are now discarded **before** they reach the network while the server is dropping them.
  Previously every report still cost a round trip: the server accepts a report it has decided to
  discard and answers `200`, which the SDK must not retry, so an app over its allowance kept
  sending full volume for nothing. The client now closes a gate on the first drop and reopens it
  when the drop is expected to have cleared, letting a single probe request through to find out.
  Traffic from an exhausted account falls to roughly one request per window instead of one per
  report.
- The drop response's `reason` is read and sets how long suppression lasts — `quota` until the
  next midnight UTC (when the daily allowance refills), `paused` and `archived` for 30 minutes,
  since those clear whenever someone changes them in the dashboard. A server that sends only the
  legacy `quota_exceeded` flag is treated as a quota drop, and an unfamiliar `reason` from a newer
  server takes the short window rather than assuming a day.
- Descriptions handle values a plain `JSON.stringify` mishandles: circular references become
  `[Circular]` while the rest of the object survives, `bigint` and functions are rendered instead
  of throwing, `Map`/`Set` are expanded, and an `Error` nested inside a context object contributes
  its message and stack rather than serializing to `{}`.

### Changed

- Minimum supported Node version raised to 20.
- Stringified descriptions are pretty-printed with a two-space indent rather than compact JSON,
  matching the PHP SDK byte for byte.
- A description clamped to the 60 000-character limit now ends with `… truncated`.
- Values that cannot be stringified report their constructor name (`[Request]`) instead of
  `[object Object]`.
- The warning logged when the server drops a report now names the cause (allowance exhausted,
  project paused, project archived) and says when reporting resumes. It previously said "monthly
  quota" unconditionally, which no longer matches the daily allowance window.

## [1.0.0] - 2026-07-13

### Added

- `createClient()` with the 16 severity×priority reporting methods
  (`critical`, `criticalLow`, … `minorHigh`), generated from the severity/priority tables and
  fully typed.
- Bearer auth for publishable keys and HMAC-SHA256 request signing for secret keys (WebCrypto,
  so the same build runs on Node 18+, browsers, and edge runtimes).
- Background delivery: bounded queue (drop-newest overflow policy), bounded concurrency,
  interval draining, and `flush()`.
- Resilience: per-request timeout, retries with exponential backoff + jitter for 429/5xx/network
  failures, `Retry-After` support, and quota-drop awareness.
- Safety: `beforeSend` scrubbing hook, sampling (`sampleRate`), client-side clamping to API
  limits, secret-redacting debug logger, and graceful-shutdown flushing (Node `beforeExit`,
  browser `pagehide` with `keepalive`).
- Optional payload encryption via libsodium-compatible sealed boxes
  (`tweetnacl-sealedbox-js`, a bundled dependency that is lazy-loaded only when encryption is
  enabled).
- `baseUrl` option for pointing the SDK at a different BugBoard origin
  (`http://localhost:8000`, trailing slash optional) — the SDK appends `/api/v1/tasks` itself.
  A base URL that isn't absolute warns and falls back to `https://bugboard.dev`.

[unreleased]: https://github.com/bug-board/bugboard-js/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/bug-board/bugboard-js/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bug-board/bugboard-js/releases/tag/v1.0.0
