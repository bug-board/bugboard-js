# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

[unreleased]: https://github.com/bug-board/bugboard-js/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/bug-board/bugboard-js/releases/tag/v1.0.0
