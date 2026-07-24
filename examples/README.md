# BugBoard JS — Examples

Focused, copy-paste-ready examples for every way to use the `bugboard` package. Each file stands on
its own and is heavily commented; read the one that matches your situation and adapt it.

For the long-form narrative — framework lifecycle details, delivery guarantees, troubleshooting —
see [`../docs/USAGE.md`](../docs/USAGE.md). These examples are the short form.

## Install

```bash
npm install bugboard
```

The examples `import … from 'bugboard'`, so they run against the published package exactly as your
app would. They're written in TypeScript; run one with [`tsx`](https://tsm.sh) without a build step:

```bash
npx tsx examples/03-severity-and-priority.ts
```

Set `logLocally: true` (or `enabled: false`) in any example to exercise it without sending real
network traffic — reports are printed instead of delivered.

## Which key do I use?

| Where your code runs | Key | Config fields |
| --- | --- | --- |
| Browser / anything shipped to users | **Publishable** (`bb_pub_…`) | `apiKey` |
| Server, worker, CLI, edge | **Secret** (`bbk_…` + `bb_sec_…`) | `keyId` + `signingSecret` |

Never put a secret key in client-side code — see [`01-browser-publishable-key.ts`](./01-browser-publishable-key.ts)
and [`02-node-server-hmac.ts`](./02-node-server-hmac.ts).

## The examples

| File | What it shows |
| --- | --- |
| [`shared-client.ts`](./shared-client.ts) | The one-module pattern; server vs client split |
| [`01-browser-publishable-key.ts`](./01-browser-publishable-key.ts) | Browser SPA with a publishable key + global error handlers |
| [`02-node-server-hmac.ts`](./02-node-server-hmac.ts) | Node server with a secret key (HMAC) + Express error middleware |
| [`03-severity-and-priority.ts`](./03-severity-and-priority.ts) | All 16 reporting methods and what the description accepts |
| [`04-payload-encryption.ts`](./04-payload-encryption.ts) | Sealed-box payload encryption (X25519) |
| [`05-before-send-scrubbing.ts`](./05-before-send-scrubbing.ts) | Scrub PII, drop noise, and route reports with `beforeSend` |
| [`06-serverless-flush.ts`](./06-serverless-flush.ts) | Flushing on Lambda, Cloudflare Workers, Vercel Edge, and Deno |
| [`07-sampling-and-tuning.ts`](./07-sampling-and-tuning.ts) | `sampleRate`, `maxQueueSize`, and per-runtime tuning |
| [`08-process-handlers.ts`](./08-process-handlers.ts) | Catching `uncaughtException` / `unhandledRejection` / `SIGTERM` |
| [`09-nextjs/`](./09-nextjs/) | Next.js: server-only + client modules, route handlers, error boundaries |
| [`10-react-error-boundary.tsx`](./10-react-error-boundary.tsx) | React error boundary and Vue error handler |
| [`11-testing.ts`](./11-testing.ts) | Fake client injection, dry runs, disabling in tests |
| [`12-typescript-types.ts`](./12-typescript-types.ts) | Using the exported types to map your own severity logic |

## Two rules that apply to every example

1. **Never `await` a report call.** It returns `void` synchronously — awaiting it does nothing.
   Use `await client.flush()` to force delivery.
2. **Keep titles stable.** Dedup is server-side and matches on the title; put variable data
   (ids, timestamps) in the description or tags, never the title.
