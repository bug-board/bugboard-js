# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The internal `endpoint` option is now `baseUrl` and takes an origin (`http://localhost:8000`,
  trailing slash optional) instead of the full ingestion URL — the SDK appends `/api/v1/tasks`
  itself. Only the origin is honored; a base URL that isn't absolute warns and falls back to
  `https://bugboard.dev`.

## [0.1.0] - 2026-07-02

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

[unreleased]: https://github.com/bug-board/bugboard-js/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bug-board/bugboard-js/releases/tag/v0.1.0
