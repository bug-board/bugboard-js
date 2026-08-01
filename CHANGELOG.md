# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-08-01

This release is about **where a card points**. Reporting an error now names the code that threw it
rather than the code that reported it, bundled apps can get their real file names back with a build
plugin, and `line_number` became opt-in because outside a plugin build it was a guess. See
[SOURCE_LOCATIONS.md](SOURCE_LOCATIONS.md) for the whole picture.

### Changed

- **A reported `Error` now locates the card at its throw site, not at the reporting call.** The
  SDK reads the error's own stack — following `cause` to the innermost error — instead of taking
  its own, so `bugboard.criticalHigh(err.message, err)` points at the code that failed. This is
  what makes central reporting work: a `window.onerror`, `process.on('uncaughtException')`, or
  Express error middleware previously stamped every card in the application with the handler's own
  file, and because `file_name` is part of server-side dedup, that merged unrelated bugs onto one
  card. An error's location outranks a build plugin's injected one, which is exact but answers the
  less useful question. A dependency throw site is reported as it is rather than guessed past;
  runtime-internal frames (`node:internal/…`) are skipped. Reports that carry no error are
  unaffected, and `captureLocation: false` still turns off all of it. See
  [SOURCE_LOCATIONS.md](SOURCE_LOCATIONS.md#errors-report-their-own-throw-site).

- **`line_number` is no longer sent unless you ask for it.** `file_name` still is. The two halves
  of a location are not equally reliable: in a bundled app with no build plugin every stack frame
  names the same chunk, so the file is right whichever frame is picked, while the line is chosen by
  frame depth — a guess that inlining, wrapping and minification all move. The same asymmetry
  appears without a bundler when reporting calls go through a helper of your own: the line is the
  helper's, identical for every report in the app. A wrong file name is self-evidently wrong; a
  wrong line number is a real line in the right file and reads as authoritative, which is worse.
  Set `lineNumbers: true` to send it — worth doing once a build plugin is installed, since that
  makes the line exact. See [SOURCE_LOCATIONS.md](SOURCE_LOCATIONS.md#line-numbers).

### Added

- **Build plugins that give bundled apps real file names and line numbers, with no source maps.**
  `bugboard/vite`, `bugboard/rollup`, `bugboard/webpack` and `bugboard/esbuild` rewrite each
  reporting call at build time — while the bundler still knows the original module and line — so
  the location survives chunking and minification as a plain string literal. Nothing is generated,
  deployed, or uploaded. Options: `clientModules`, `root`, `include`, `exclude`, `loose`, `debug`.
  JSX and TSX are supported, including calls inside expression containers like
  `onClick={() => bugboard.critical('…')}`, as are Vue and Svelte `<script>` blocks.

  Verified end to end against Vite (React, Vue, Svelte), SvelteKit, Nuxt, Remix/React Router,
  Next.js (Turbopack and webpack), Express, Fastify, Koa, NestJS, AWS Lambda, Cloudflare Workers,
  the Vercel Edge runtime, Deno, Bun, and plain CLI scripts.
- **`bugboard/preload`** and an exported `enableSourceMaps()`, which switch on Node's own
  source-map support so server stacks resolve against the `.js.map` files already next to your
  chunks. Import it before your application code — Node only maps modules compiled after support is
  enabled, which is why `createClient()` alone is not enough.
- **`sourceMaps` config option.** Defaults to `true` on Node (free — the maps are on disk) and
  `false` in browsers, where enabling it makes the SDK fetch a chunk's `.js.map` at report time.
  The browser path ships as a separate lazily-loaded chunk, so it costs nothing unless turned on.

### Fixed

- **A description whose `stack` or `message` threw when read cost the whole report.** `errorText`
  read both properties unguarded, and it is reached from `buildPayload` outside every try/catch
  except the client's own backstop — which drops the card rather than the field. They are plain
  properties on a plain `Error` and getters on a Proxy, a framework wrapper, or a test double, and
  a getter can throw. The description ladder is now total, matching the PHP SDK's: a hostile error
  degrades to `[Error]`, one nested in a context object degrades alone while the rest of the object
  still serializes, and `label()` — what every other rung falls back to — no longer throws on a
  hostile `constructor` either.
- **Bundled browser builds reported no location at all.** Call-site capture skipped every frame
  sharing the SDK's directory to find the caller, but after a production build the SDK and the
  application land in the same chunk — or in sibling chunks under one directory — so the scan
  consumed the whole stack and returned nothing. It now falls back to the first frame in a
  different *file*, and then to frame depth, so a location is always reported even without a build
  plugin. The plugin remains the only way to get the *original* file and line.
- **A dependency could be reported as the call site.** Libraries call your code — a framework
  invoking an event handler, a router invoking a route — and those frames sit between the SDK and
  anything you wrote, in a different directory, which is exactly what the caller scan looks for. A
  report from a Vue template handler named `@vue/runtime-core/dist/runtime-core.js:200`. Frames
  inside `node_modules` are now held back, and every application frame — including the
  frame-depth guess — is exhausted before one is considered.
- **Node internal frames could be reported as the call site.** A report made at module top level
  has `node:internal/modules/esm/module_job` beneath it, and its directory differs from the SDK's,
  so the caller scan matched it in preference to the real frame. `node:` frames are now excluded
  before the scan.
- **The `async` keyword leaked into file names.** V8 writes an awaited frame with no function name
  as `at async /app/boot.js:14:1` — with no parentheses to strip — which was parsed as a file
  called `async /app/boot.js`.
- **The published bundle could not be built for browsers or edge runtimes.** tsup rewrote the
  lazy `import('node:crypto')` to bare `import('crypto')`, which no browser or edge bundler can
  resolve — and which on npm is an unrelated package. The `node:` prefix is now preserved, and a
  `browser` field maps it away entirely so a browser or edge build needs no configuration.
  Cloudflare Workers, the Vercel Edge runtime, Deno and Bun are all covered by tests now.
- **Vue components reported a wrong line, Svelte components reported none.** Vite hands back the
  framework compiler's output for a component under the original file's id
  (`App.vue?vue&type=script&…`), and its line numbers are the compiler's, not yours. Those blocks
  are now skipped; the raw `.vue`/`.svelte` file is rewritten instead, where the lines are real.
- **Nuxt missed every server route.** Nitro builds `server/` with its own Rollup pipeline rather
  than the Vite config, so the plugin has to be registered there too (see the Nuxt guide). Paths
  from a plain Rollup build are also no longer absolute: outside Vite there is no `configResolved`
  to supply the project root, so it now falls back to the working directory.

## [1.1.2] - 2026-07-24

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

[unreleased]: https://github.com/bug-board/bugboard-js/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/bug-board/bugboard-js/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/bug-board/bugboard-js/compare/v1.1.1...v1.1.2
[1.1.0]: https://github.com/bug-board/bugboard-js/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bug-board/bugboard-js/releases/tag/v1.0.0
