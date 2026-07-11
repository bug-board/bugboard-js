# BugBoard SDK for JavaScript

[![CI](https://github.com/bug-board/bugboard-js/actions/workflows/ci.yml/badge.svg)](https://github.com/bug-board/bugboard-js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/bugboard.svg)](https://www.npmjs.com/package/bugboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The official [BugBoard](https://bugboard.dev) SDK for JavaScript and TypeScript. Report errors as
**cards** on your project board — from Node 18+, browsers, and edge runtimes — built on the platform
`fetch`. Importing the SDK pulls in **nothing else**: the one bundled dependency is a sealed-box
binding that is lazy-loaded only if you turn on payload encryption.

```ts
import { createClient } from 'bugboard';

const bugboard = createClient({ apiKey: import.meta.env.VITE_BUGBOARD_API_KEY });

try {
  await payments.charge(order);
} catch (err) {
  bugboard.criticalHigh('Payment failed', err, ['payment', 'backend']);
}
```

Reporting is **fire-and-forget**: the call returns immediately, delivery happens on a background
queue with retries and backoff, and the SDK **never throws into your app**.

## Installation

```bash
npm install bugboard
```

There is nothing framework-specific to install. The SDK is a single framework-agnostic client that
uses only platform APIs (`fetch`, WebCrypto), so the same package runs unchanged on Node 18+, in any
browser or bundler (Vite, webpack, Next.js, Nuxt…), and on edge runtimes (Cloudflare Workers, Vercel
Edge, Deno). It ships ESM + CJS builds with full TypeScript types.

## Setup

Create one file that configures a shared client, then import it anywhere.

### Browser / client-side (publishable key)

Use a **publishable key** (`bb_pub_…`) — public by design and write-only, sent as a bearer token.

```ts
// utils/bugboard.ts
import { createClient } from 'bugboard';

export default createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY, // bb_pub_…
});
```

```dotenv
VITE_BUGBOARD_API_KEY=bb_pub_xxxxxxxx
```

### Server / Node (secret key)

Use a **secret key** — a key id (`bbk_…`) plus a signing secret (`bb_sec_…`). Every request is
HMAC-signed; **the secret never travels on the wire**.

```ts
// utils/bugboard.ts
import { createClient } from 'bugboard';

export default createClient({
  keyId: process.env.BUGBOARD_KEY_ID, // bbk_…
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET, // bb_sec_…
});
```

```dotenv
BUGBOARD_KEY_ID=bbk_xxxxxxxx
BUGBOARD_SIGNING_SECRET=bb_sec_xxxxxxxx
```

> Get keys from your BugBoard project under **Settings → API Keys**. Use the key type that
> matches where the code runs: publishable in anything shipped to users, secret on servers.

### Framework environment variables

| Framework               | Variable                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Vite (React/Vue/Svelte) | `VITE_BUGBOARD_API_KEY`                                                                                           |
| Next.js (client)        | `NEXT_PUBLIC_BUGBOARD_API_KEY`                                                                                    |
| Nuxt                    | `runtimeConfig.public.bugboardApiKey` (client) / `runtimeConfig.bugboardKeyId` + `bugboardSigningSecret` (server) |
| Node / Express / edge   | `BUGBOARD_KEY_ID` + `BUGBOARD_SIGNING_SECRET`                                                                     |

## Usage

Call a severity method with a **title** (required); optionally pass a description — a string or
the caught error — and tags (an array or a CSV string):

```ts
import bugboard from '@/utils/bugboard';

bugboard.major('Checkout is slow'); // a title is all you need
bugboard.critical('Payment failed', err); // attach the caught error
bugboard.critical('Payment failed', err, ['payments', 'checkout']);
bugboard.critical('Payment failed', err, 'payments,checkout');
```

### The 16 reporting methods

The method name sets the card's severity and priority — there is no generic `report()`:

|              | low           | medium (default)              | high           |
| ------------ | ------------- | ----------------------------- | -------------- |
| **critical** | `criticalLow` | `critical` / `criticalMedium` | `criticalHigh` |
| **major**    | `majorLow`    | `major` / `majorMedium`       | `majorHigh`    |
| **moderate** | `moderateLow` | `moderate` / `moderateMedium` | `moderateHigh` |
| **minor**    | `minorLow`    | `minor` / `minorMedium`       | `minorHigh`    |

Most apps only need the four medium-priority methods: `critical`, `major`, `moderate`, `minor`.

### Serverless / short-lived scripts

Reports are delivered in the background, and the SDK flushes automatically on shutdown (Node
`beforeExit`, browser `pagehide`). In environments without lifecycle hooks — lambdas, edge
functions, CLI scripts — flush before returning:

```ts
await bugboard.flush();
```

## Configuration

```ts
const bugboard = createClient({
  apiKey: '…', // or keyId + signingSecret
  environment: 'production',
  release: '1.4.2',
  sampleRate: 0.5,
  beforeSend: (payload) => {
    if (payload.description?.includes('@')) return null; // drop reports containing emails
    return payload;
  },
});
```

| Option                | Type       | Default | Purpose                                                                           |
| --------------------- | ---------- | ------- | --------------------------------------------------------------------------------- |
| `apiKey`              | `string`   | —       | Publishable key (`bb_pub_…`), sent as a bearer token. Browser / client-side.      |
| `keyId`               | `string`   | —       | Public key id (`bbk_…`) for HMAC auth. Servers.                                   |
| `signingSecret`       | `string`   | —       | Signing secret (`bb_sec_…`). Never transmitted.                                   |
| `encryptionPublicKey` | `string`   | —       | Base64 X25519 public key. When set, every payload is encrypted in transit.        |
| `encryptionKeyId`     | `string`   | —       | `bbek_…` id echoed in the envelope (enables key rotation).                        |
| `enabled`             | `boolean`  | `true`  | Master switch (e.g. disable in tests).                                            |
| `environment`         | `string`   | —       | Added to every card as tag `env:<value>`.                                         |
| `release`             | `string`   | —       | Added to every card as tag `release:<value>`.                                     |
| `defaultTags`         | `string[]` | `[]`    | Merged into every card's tags.                                                    |
| `sampleRate`          | `number`   | `1.0`   | Probability (0–1) a report is sent.                                               |
| `maxQueueSize`        | `number`   | `100`   | Queue cap; overflow drops the newest report.                                      |
| `concurrency`         | `number`   | `3`     | Parallel in-flight requests when draining.                                        |
| `flushIntervalMs`     | `number`   | `2000`  | Background drain cadence.                                                         |
| `timeoutMs`           | `number`   | `5000`  | Per-request timeout.                                                              |
| `maxRetries`          | `number`   | `3`     | Retries for 429/5xx/network errors (with backoff + jitter, honors `Retry-After`). |
| `beforeSend`          | `function` | —       | Scrub PII or veto a report — return the payload, or `null` to drop it.            |
| `debug`               | `boolean`  | `false` | Verbose internal logging (keys always redacted).                                  |
| `logLocally`          | `boolean`  | `false` | Log each report locally instead of sending it (dry run).                          |
| `captureLocation`     | `boolean`  | `true`  | Auto-capture the caller's file/line as `file_name`/`line_number`.                 |
| `hideApiResponse`     | `boolean`  | `true`  | Ask the server to omit the card from its response (not echoed back).              |

Provide **either** `apiKey` **or** `keyId` + `signingSecret` — the SDK picks bearer or HMAC auth
from which is set. With no credentials the client disables itself with a warning instead of
throwing.

## Encrypting sensitive reports

Request bodies are readable in the browser network tab and at TLS-terminating proxies. Set an
encryption key and every payload is sealed (libsodium sealed box, X25519) before it leaves the
client — opaque everywhere on the wire; BugBoard decrypts on receipt.

The sealed-box binding (`tweetnacl-sealedbox-js`) ships with `bugboard` and is lazy-loaded
automatically the first time an encryption key is used — nothing extra to install:

```ts
export default createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,
  encryptionPublicKey: import.meta.env.VITE_BUGBOARD_ENCRYPTION_PUBLIC_KEY, // base64 X25519
  encryptionKeyId: import.meta.env.VITE_BUGBOARD_ENCRYPTION_KEY_ID, // bbek_…
});
```

Generate the keypair under **Settings → API Keys → Payload encryption**. The public key is safe
to embed in client code; the private key never leaves BugBoard.

## Delivery semantics

- **Never blocks, never throws.** Reporting methods return `void` immediately; failures surface
  on the debug channel (`debug: true`), not in your app.
- **Retries** on 429/5xx/network errors with exponential backoff + jitter, honoring
  `Retry-After`. Other 4xx (bad key, invalid payload) are never retried.
- **Deduplication is server-side**: a report whose title or description exactly matches an
  existing card increments its occurrence count instead of creating a duplicate — so use stable,
  deterministic titles (no timestamps or UUIDs in the title).
- **Quota drops are silent by design**: when the project's monthly quota is exhausted the server
  accepts and drops the report — the SDK logs it in debug mode and does not retry.

## TypeScript

Everything is fully typed, including all 16 method names:

```ts
import type {
  BugBoardClient, // the client: 16 report methods + flush()
  BugBoardConfig, // every option in the table above
  ReportPayload, // what beforeSend receives and returns
  ReportFn, // (title, description?, tags?) => void
  ReportMethodName, // 'critical' | 'criticalLow' | … the 16 names
  Severity, // 'critical' | 'major' | 'moderate' | 'minor'
  Priority, // 'low' | 'medium' | 'high'
  TagsInput, // readonly string[] | string
} from 'bugboard';
```

## Error types

The SDK **never throws into your app** — these are exported so you can recognize failures on the
debug channel and in your own logging, not because you have to catch them:

| Class                     | Raised on                      | Extra                                   |
| ------------------------- | ------------------------------ | --------------------------------------- |
| `BugBoardError`           | base class for the four below  | —                                       |
| `BugBoardAuthError`       | 401 / 403 — bad or revoked key | —                                       |
| `BugBoardValidationError` | 422 — the payload was rejected | `fieldErrors: Record<string, string[]>` |
| `BugBoardRateLimitError`  | 429 — too many reports         | `retryAfter?: number` (seconds)         |
| `BugBoardServerError`     | 5xx, network failure, timeout  | —                                       |

## Contributing

Bug reports and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please read
our [Code of Conduct](CODE_OF_CONDUCT.md) and report security issues per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © BugBoard
