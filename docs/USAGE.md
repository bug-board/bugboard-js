# BugBoard JS — Usage Guide

A complete guide to installing, configuring, and using the `bugboard` package in Node, browsers,
bundlers, meta-frameworks, and edge runtimes.

The [README](../README.md) is the quick start. This document is the long form: how to wire the
client into each kind of application, where reports actually get delivered in each runtime's
lifecycle, and the gotchas specific to each one.

## Contents

- [Core concepts](#core-concepts) — read this first, everything else builds on it
- [Installation](#installation)
- [Credentials: which key goes where](#credentials-which-key-goes-where)
- [The shared client module](#the-shared-client-module)
- [Delivery and flushing](#delivery-and-flushing) — the one thing that differs by runtime
- [Framework guides](#framework-guides)
  - [Node: Express, Fastify, Koa](#node-express-fastify-koa)
  - [NestJS](#nestjs)
  - [Next.js](#nextjs)
  - [Nuxt](#nuxt)
  - [SvelteKit](#sveltekit)
  - [Remix / React Router](#remix--react-router)
  - [Vite SPA: React, Vue, Svelte](#vite-spa-react-vue-svelte)
  - [Serverless: Lambda, Vercel, Cloudflare Workers, Deno](#serverless-lambda-vercel-cloudflare-workers-deno)
  - [CLI tools and scripts](#cli-tools-and-scripts)
- [Configuration reference](#configuration-reference)
- [Payload encryption](#payload-encryption)
- [TypeScript](#typescript)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Core concepts

Five facts explain nearly everything about how this SDK behaves.

**1. There is no `report()` method — the method name is the classification.**

The client exposes exactly 16 methods, one per severity×priority pair. A bare severity name is the
medium-priority variant:

|              | low           | medium (default)              | high           |
| ------------ | ------------- | ----------------------------- | -------------- |
| **critical** | `criticalLow` | `critical` / `criticalMedium` | `criticalHigh` |
| **major**    | `majorLow`    | `major` / `majorMedium`       | `majorHigh`    |
| **moderate** | `moderateLow` | `moderate` / `moderateMedium` | `moderateHigh` |
| **minor**    | `minorLow`    | `minor` / `minorMedium`       | `minorHigh`    |

Every one takes the same arguments:

```ts
bugboard.criticalHigh(
  'Payment capture failed',   // string — required, clamped to 255 chars
  err,                        // string | Error | unknown — optional
  ['payments', 'stripe'],     // string[] | 'csv,string' — optional
);
```

Most applications only ever use the four medium methods: `critical`, `major`, `moderate`, `minor`.

**2. Reporting is fire-and-forget and never throws.**

A reporting call returns `void` immediately — synchronously, no promise, nothing to await. It builds
the payload and pushes it onto a queue; it does not perform I/O. A monitoring SDK must not crash the
app it monitors, so the whole pipeline is wrapped in a `try`/`catch` backstop
([`client.ts:70-73`](../src/client.ts#L70-L73)). Delivery failures never reach your code either —
they surface on the debug channel.

Don't write `await bugboard.critical(...)`. It returns `void`, and awaiting it does nothing except
suggest to the next reader that it does something.

**3. Delivery happens on a background queue.**

Reports drain on a timer (`flushIntervalMs`, default 2 s) with bounded concurrency (default 3), so a
burst of errors never floods the API or self-inflicts a 429
([`queue.ts:25-63`](../src/queue.ts#L25-L63)). The timer only runs while the queue is non-empty, so
an idle client schedules nothing — this matters in serverless, where a stray interval can keep an
invocation alive.

Which means: **the report you just made has not been sent yet.** In any environment that can
terminate before the next tick, you must `await bugboard.flush()`. See
[Delivery and flushing](#delivery-and-flushing).

**4. Deduplication is server-side, so titles must be stable.**

A report whose title or description exactly matches an existing card increments that card's
occurrence count instead of creating a new card. This only works if your titles are deterministic:

```ts
// Good — one card, occurrence count climbs
bugboard.major('Stripe webhook signature verification failed');

// Bad — a new card per request, forever
bugboard.major(`Stripe webhook ${req.id} failed at ${Date.now()}`);
```

Put the variable parts in the description or tags, never in the title.

**5. Bad configuration disables the client; it doesn't throw.**

No credentials, an unparseable `baseUrl`, a `sampleRate` of `"high"` — none of these throw. The
config resolver applies a sane default or disables reporting, and pushes a warning that gets logged
([`config.ts:84-144`](../src/config.ts#L84-L144)). This is intentional, and it means **a
misconfigured client is silent**. Turn on `debug` when reports aren't showing up.

---

## Installation

```bash
npm install bugboard
```

Requires **Node 20+** for server use; any modern browser or edge runtime otherwise.

There is nothing framework-specific to install and no framework-specific entry point. The SDK is one
framework-agnostic client built on platform APIs (`fetch`, WebCrypto), so the same package runs
unchanged in Node, browsers, bundlers, and edge runtimes. It ships ESM + CJS builds with full
TypeScript types.

The only dependency is `tweetnacl-sealedbox-js`, and it is dynamically imported the first time an
encryption key is used — so if you don't enable [payload encryption](#payload-encryption), importing
`bugboard` pulls in nothing. The package is marked `sideEffects: false`, so bundlers tree-shake what
you don't call.

---

## Credentials: which key goes where

BugBoard issues two kinds of key, and picking the wrong one is the most common setup mistake.

| Key type        | Config                    | Auth                | Use it in                                   |
| --------------- | ------------------------- | ------------------- | ------------------------------------------- |
| **Publishable** | `apiKey` (`bb_pub_…`)     | Bearer token        | Anything shipped to users — browser bundles |
| **Secret**      | `keyId` + `signingSecret` | HMAC-signed request | Servers, workers, CLI tools                 |

A **publishable key** is public by design and write-only. It's fine that anyone can read it out of
your JS bundle — the worst they can do is create cards on your board.

A **secret key** signs each request with an HMAC over the body; **the signing secret never travels
on the wire**. Use it anywhere you have a trusted process.

> **Never put a secret key in client-side code.** Not in `NEXT_PUBLIC_*`, not in `VITE_*`, not in
> `runtimeConfig.public`. Anything with a client-exposed prefix ends up in the bundle. The SDK
> cannot detect this for you.

The scheme is chosen from what you set ([`config.ts:90-106`](../src/config.ts#L90-L106)):

- `keyId` + `signingSecret` → HMAC
- `apiKey` only → bearer
- both → HMAC wins, with a warning
- `keyId` without `signingSecret` → falls back to `apiKey` if present, with a warning
- neither → **client disabled**, with a warning

Get keys from your BugBoard project under **Settings → API Keys**.

### Environment variable names by framework

| Framework               | Client-side (publishable)             | Server-side (secret)                                    |
| ----------------------- | ------------------------------------- | ------------------------------------------------------- |
| Vite (React/Vue/Svelte) | `VITE_BUGBOARD_API_KEY`               | —                                                       |
| Next.js                 | `NEXT_PUBLIC_BUGBOARD_API_KEY`        | `BUGBOARD_KEY_ID` + `BUGBOARD_SIGNING_SECRET`           |
| Nuxt                    | `runtimeConfig.public.bugboardApiKey` | `runtimeConfig.bugboardKeyId` + `bugboardSigningSecret` |
| SvelteKit               | `PUBLIC_BUGBOARD_API_KEY`             | `BUGBOARD_KEY_ID` + `BUGBOARD_SIGNING_SECRET`           |
| Node / Express / edge   | —                                     | `BUGBOARD_KEY_ID` + `BUGBOARD_SIGNING_SECRET`           |

---

## The shared client module

Create **one** module that configures the client and import it everywhere. The client owns a queue,
a drain timer, and a shutdown hook — creating one per file gives you N independent queues, N timers,
and N shutdown hooks.

```ts
// src/lib/bugboard.ts
import { createClient } from 'bugboard';

export default createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
});
```

```ts
import bugboard from '@/lib/bugboard';

bugboard.major('Checkout is slow');
```

In an app with **both** a server and a client bundle, make two modules. This is the pattern behind
every meta-framework section below:

```ts
// src/lib/bugboard.server.ts — secret key, never bundled for the browser
import { createClient } from 'bugboard';

export default createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  environment: process.env.NODE_ENV,
});
```

```ts
// src/lib/bugboard.client.ts — publishable key, safe in the bundle
import { createClient } from 'bugboard';

export default createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,
  environment: import.meta.env.MODE,
});
```

Adopt whatever server-only convention your framework enforces — `.server.ts` in SvelteKit and Remix,
`server-only` in Next.js — so an accidental client import fails at build time rather than shipping
your signing secret.

---

## Delivery and flushing

**This is the section that differs by runtime.** Everything else in the SDK behaves identically
everywhere.

Reports are queued and drained in the background. What guarantees the queue gets drained before the
process or page goes away depends on where you're running
([`shutdown.ts:17-31`](../src/shutdown.ts#L17-L31)):

| Runtime                             | Automatic hook             | Do you need `await flush()`?                 |
| ----------------------------------- | -------------------------- | -------------------------------------------- |
| Long-running Node server            | `process.on('beforeExit')` | No — the process outlives the queue          |
| Browser                             | `pagehide` → `flushSync()` | No, but flush before a deliberate navigation |
| Serverless / edge (Lambda, Workers) | **None**                   | **Yes — always, before returning**           |
| Short CLI script                    | `beforeExit`               | Only if you call `process.exit()`            |
| Node process ending on a signal     | **None** (see below)       | Yes — flush in your signal handler           |

### Node

`beforeExit` fires when the event loop empties, and scheduling the flush there keeps the process
alive until delivery completes. For a normal long-running server this is all handled: the process
lives far longer than any 2-second drain interval.

**`beforeExit` does not fire on `process.exit()`, on an uncaught exception, or on `SIGINT`/`SIGTERM`.**
That last one matters — a containerized server gets `SIGTERM` on every deploy. If you want in-flight
reports delivered across a rolling restart, flush in your shutdown handler:

```ts
import bugboard from './lib/bugboard';

async function shutdown(signal: string) {
  await server.close();
  await bugboard.flush(); // deliver anything queued before we go
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

### Browser

The SDK listens for `pagehide` — the last reliable moment before a page goes away, and unlike
`unload` it's respected by the bfcache and by mobile Safari. It calls `flushSync()`, which fires the
queued requests with `keepalive: true` so the browser completes them after the page is gone
([`queue.ts:83-89`](../src/queue.ts#L83-L89)).

`keepalive` requests are capped by the browser (64 KB total across in-flight keepalive requests), so
this is best-effort for a large backlog, not a guarantee. It's the right behavior for the normal
case of a handful of queued reports.

Note the hook only registers when `document` is defined — in a non-DOM worker context there is no
automatic flush, so `await flush()` yourself.

### Serverless and edge

There is no process-wide lifecycle hook, and the runtime may freeze or kill your invocation the
instant you return a response. **Always await the flush:**

```ts
export async function handler(event) {
  try {
    return await handleRequest(event);
  } catch (err) {
    bugboard.criticalHigh('Handler failed', err);
    throw err;
  } finally {
    await bugboard.flush(); // runs on both paths
  }
}
```

`flush()` on an empty queue is effectively free, so an unconditional `finally` is the right shape —
you don't need to track whether you reported anything.

Cloudflare Workers and Vercel Edge offer `ctx.waitUntil()`, which is better still: it lets the
response go out immediately while the runtime keeps the invocation alive for the flush. See the
[serverless section](#serverless-lambda-vercel-cloudflare-workers-deno).

---

## Framework guides

The client is identical across all of these. What changes is *where you construct it*, *which key
you use*, and *where you flush*.

### Node: Express, Fastify, Koa

A long-running Node server is the simple case: build the client at module scope with a secret key,
report from an error handler, and let `beforeExit` handle the rest.

**Express** — the error middleware must have four parameters or Express won't treat it as one:

```ts
// src/lib/bugboard.ts
import { createClient } from 'bugboard';

export default createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
});
```

```ts
// src/app.ts
import express from 'express';
import bugboard from './lib/bugboard';

const app = express();

// … routes …

app.use((err, req, res, next) => {
  bugboard.criticalHigh(
    `Unhandled error: ${req.method} ${req.route?.path ?? 'unknown route'}`,
    err,
    ['express', 'unhandled'],
  );

  res.status(500).json({ error: 'Internal Server Error' });
});
```

Note the title: `req.route?.path` is the **route pattern** (`/users/:id`), not the URL
(`/users/91847`). Using `req.path` would create a card per user id. This is the dedup rule applied
in practice, and it's the single most valuable habit in a server integration.

**Fastify:**

```ts
fastify.setErrorHandler((error, request, reply) => {
  // Don't report 4xx — those are client mistakes, not your bugs.
  if ((error.statusCode ?? 500) >= 500) {
    bugboard.criticalHigh(
      `Unhandled error: ${request.method} ${request.routeOptions.url}`,
      error,
      ['fastify', 'unhandled'],
    );
  }

  reply.status(error.statusCode ?? 500).send({ error: 'Internal Server Error' });
});
```

**Koa:**

```ts
app.on('error', (err, ctx) => {
  bugboard.criticalHigh(`Unhandled error: ${ctx.method} ${ctx._matchedRoute ?? ctx.path}`, err, [
    'koa',
  ]);
});
```

**Process-level handlers**, for what escapes the framework:

```ts
process.on('unhandledRejection', (reason) => {
  bugboard.criticalHigh('Unhandled promise rejection', reason, ['process']);
});

process.on('uncaughtException', (err) => {
  bugboard.criticalHigh('Uncaught exception', err, ['process']);

  // The process is in an undefined state — flush, then let it die.
  void bugboard.flush().finally(() => process.exit(1));
});
```

The `flush()` in `uncaughtException` is required. `beforeExit` will not fire on this path, and
`process.exit()` would otherwise discard the report describing why you crashed — the single most
valuable report you'll ever queue.

Also add the [`SIGTERM` handler](#node) if you deploy to containers.

### NestJS

Register the client as a provider so it's injectable and mockable:

```ts
// src/bugboard/bugboard.module.ts
import { Global, Module } from '@nestjs/common';
import { createClient, type BugBoardClient } from 'bugboard';

export const BUGBOARD = Symbol('BUGBOARD');

@Global()
@Module({
  providers: [
    {
      provide: BUGBOARD,
      useFactory: (): BugBoardClient =>
        createClient({
          keyId: process.env.BUGBOARD_KEY_ID,
          signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
          environment: process.env.NODE_ENV,
        }),
    },
  ],
  exports: [BUGBOARD],
})
export class BugBoardModule {}
```

An exception filter is the natural reporting point:

```ts
// src/bugboard/bugboard-exception.filter.ts
import { ArgumentsHost, Catch, HttpException, Inject } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { BugBoardClient } from 'bugboard';
import { BUGBOARD } from './bugboard.module';

@Catch()
export class BugBoardExceptionFilter extends BaseExceptionFilter {
  constructor(@Inject(BUGBOARD) private readonly bugboard: BugBoardClient) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      const req = host.switchToHttp().getRequest();
      this.bugboard.criticalHigh(`Unhandled error: ${req.method} ${req.route?.path}`, exception, [
        'nestjs',
      ]);
    }

    super.catch(exception, host);
  }
}
```

Flush on shutdown via the lifecycle hook:

```ts
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class BugBoardShutdown implements OnApplicationShutdown {
  constructor(@Inject(BUGBOARD) private readonly bugboard: BugBoardClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.bugboard.flush();
  }
}
```

This requires `app.enableShutdownHooks()` in `main.ts`.

### Next.js

Next.js runs your code in three places, and they need different treatment.

**Server: two modules, one guard.**

```ts
// lib/bugboard.server.ts
import 'server-only'; // build error if this is ever imported from a client component
import { createClient } from 'bugboard';

export default createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
});
```

```ts
// lib/bugboard.client.ts
'use client';
import { createClient } from 'bugboard';

export default createClient({
  apiKey: process.env.NEXT_PUBLIC_BUGBOARD_API_KEY,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV,
});
```

The `server-only` package (`npm i server-only`) turns a leaked secret key into a build failure. Use it.

**Route handlers and server actions** — flush before returning, because these may run on serverless
or edge:

```ts
// app/api/checkout/route.ts
import bugboard from '@/lib/bugboard.server';

export async function POST(request: Request) {
  try {
    return Response.json(await processCheckout(await request.json()));
  } catch (err) {
    bugboard.criticalHigh('Checkout API failed', err, ['api', 'checkout']);
    return Response.json({ error: 'Checkout failed' }, { status: 500 });
  } finally {
    await bugboard.flush();
  }
}
```

**Global error boundaries** — App Router gives you two files, and you want both:

```tsx
// app/error.tsx — recoverable errors within a route segment
'use client';
import { useEffect } from 'react';
import bugboard from '@/lib/bugboard.client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    bugboard.critical(`Route error: ${error.message}`, error, ['nextjs', 'client']);
  }, [error]);

  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

```tsx
// app/global-error.tsx — root layout errors; must render <html> and <body>
'use client';
import { useEffect } from 'react';
import bugboard from '@/lib/bugboard.client';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    bugboard.criticalHigh(`Root error: ${error.message}`, error, ['nextjs', 'fatal']);
  }, [error]);

  return (
    <html>
      <body>
        <h2>Something went wrong</h2>
      </body>
    </html>
  );
}
```

In production, a server component error reaching the client is redacted to a generic message plus a
`digest`. So `error.message` from `error.tsx` is often unhelpful, and the *useful* report is the
server-side one — which is why the `instrumentation.ts` hook below matters.

**`instrumentation.ts`** catches server errors Next.js handles internally, before they're redacted:

```ts
// instrumentation.ts (Next.js 15+)
export async function onRequestError(err, request, context) {
  const bugboard = (await import('@/lib/bugboard.server')).default;

  bugboard.criticalHigh(`Server error: ${context.routePath ?? request.path}`, err, [
    'nextjs',
    'server',
    context.routerKind,
  ]);

  await bugboard.flush();
}
```

Use `context.routePath` (the pattern) over `request.path` (the URL) for the same dedup reason as
Express.

**Pages Router**, if that's what you're on: use `_error.tsx` for client errors and wrap API routes in
try/finally exactly as above.

### Nuxt

Nuxt's `runtimeConfig` splits public and private for you — `public` reaches the browser, everything
else stays on the server:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    bugboardKeyId: '',        // NUXT_BUGBOARD_KEY_ID — server only
    bugboardSigningSecret: '', // NUXT_BUGBOARD_SIGNING_SECRET — server only
    public: {
      bugboardApiKey: '',     // NUXT_PUBLIC_BUGBOARD_API_KEY — client
    },
  },
});
```

**Client plugin**, which also hooks Vue's error handler:

```ts
// plugins/bugboard.client.ts
import { createClient } from 'bugboard';

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  const bugboard = createClient({
    apiKey: config.public.bugboardApiKey,
    environment: import.meta.dev ? 'development' : 'production',
  });

  nuxtApp.hook('vue:error', (error, instance, info) => {
    bugboard.critical(`Vue error: ${info}`, error, ['nuxt', 'client']);
  });

  return { provide: { bugboard } };
});
```

**Server plugin:**

```ts
// server/plugins/bugboard.ts
import { createClient } from 'bugboard';

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig();

  const bugboard = createClient({
    keyId: config.bugboardKeyId,
    signingSecret: config.bugboardSigningSecret,
    environment: process.env.NODE_ENV,
  });

  nitroApp.hooks.hook('error', async (error, { event }) => {
    bugboard.criticalHigh(`Server error: ${event?.path ?? 'unknown'}`, error, ['nuxt', 'server']);
    await bugboard.flush(); // Nitro may be deployed to a serverless target
  });
});
```

Usage in components:

```vue
<script setup lang="ts">
const { $bugboard } = useNuxtApp();

async function submit() {
  try {
    await $fetch('/api/checkout', { method: 'POST' });
  } catch (err) {
    $bugboard.major('Checkout request failed', err, ['checkout']);
  }
}
</script>
```

The `await flush()` in the Nitro hook is deliberate: Nitro targets Node, Vercel, Cloudflare, and
Deno from the same code, and on the serverless targets nothing else will drain the queue.

### SvelteKit

SvelteKit's `$env` modules enforce the split at build time — importing `$env/static/private` into
client code is a build error.

```ts
// src/lib/bugboard.server.ts
import { createClient } from 'bugboard';
import { BUGBOARD_KEY_ID, BUGBOARD_SIGNING_SECRET } from '$env/static/private';
import { dev } from '$app/environment';

export default createClient({
  keyId: BUGBOARD_KEY_ID,
  signingSecret: BUGBOARD_SIGNING_SECRET,
  environment: dev ? 'development' : 'production',
});
```

```ts
// src/lib/bugboard.ts (client)
import { createClient } from 'bugboard';
import { PUBLIC_BUGBOARD_API_KEY } from '$env/static/public';
import { dev } from '$app/environment';

export default createClient({
  apiKey: PUBLIC_BUGBOARD_API_KEY,
  environment: dev ? 'development' : 'production',
});
```

Both hook files map straight onto the SDK:

```ts
// src/hooks.server.ts
import type { HandleServerError } from '@sveltejs/kit';
import bugboard from '$lib/bugboard.server';

export const handleError: HandleServerError = async ({ error, event, status }) => {
  if (status !== 404) {
    bugboard.criticalHigh(`Server error: ${event.route.id ?? event.url.pathname}`, error, [
      'sveltekit',
      'server',
    ]);
    await bugboard.flush(); // adapter-vercel / adapter-cloudflare may freeze right after
  }

  return { message: 'Internal Error' };
};
```

```ts
// src/hooks.client.ts
import type { HandleClientError } from '@sveltejs/kit';
import bugboard from '$lib/bugboard';

export const handleClientError: HandleClientError = ({ error, event }) => {
  bugboard.critical(`Client error: ${event.route.id ?? event.url.pathname}`, error, [
    'sveltekit',
    'client',
  ]);

  return { message: 'Something went wrong' };
};
```

`event.route.id` is the route pattern (`/products/[id]`), which is what you want in the title.

### Remix / React Router

```ts
// app/lib/bugboard.server.ts
import { createClient } from 'bugboard';

export default createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  environment: process.env.NODE_ENV,
});
```

```ts
// app/entry.server.tsx
import bugboard from './lib/bugboard.server';

export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted) return; // user navigated away; not a bug

  bugboard.criticalHigh(`Server error: ${new URL(request.url).pathname}`, error, ['remix']);
  void bugboard.flush();
}
```

The `request.signal.aborted` check filters out cancelled navigations, which would otherwise show up
as a steady stream of phantom errors.

Client-side, report from an `ErrorBoundary`:

```tsx
// app/root.tsx
import { useRouteError, isRouteErrorResponse } from '@remix-run/react';
import { useEffect } from 'react';
import bugboard from '~/lib/bugboard.client';

export function ErrorBoundary() {
  const error = useRouteError();

  useEffect(() => {
    if (!isRouteErrorResponse(error)) {
      bugboard.critical('Client route error', error, ['remix', 'client']);
    }
  }, [error]);

  return <p>Something went wrong</p>;
}
```

### Vite SPA: React, Vue, Svelte

A pure client-side app uses a publishable key and nothing else.

```ts
// src/lib/bugboard.ts
import { createClient } from 'bugboard';

export default createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,
  environment: import.meta.env.MODE,
  release: __APP_VERSION__, // via vite.config define, if you want it
  enabled: import.meta.env.PROD, // don't report from local dev
});
```

```dotenv
VITE_BUGBOARD_API_KEY=bb_pub_xxxxxxxx
```

**Global handlers** catch what your components don't:

```ts
// src/main.ts
import bugboard from './lib/bugboard';

window.addEventListener('error', (event) => {
  bugboard.critical(`Uncaught: ${event.message}`, event.error, ['browser']);
});

window.addEventListener('unhandledrejection', (event) => {
  bugboard.critical('Unhandled promise rejection', event.reason, ['browser']);
});
```

Browsers report cross-origin script errors as the opaque string `"Script error."` with no stack. To
get real messages from a CDN-hosted bundle, serve it with `Access-Control-Allow-Origin` and add
`crossorigin` to the `<script>` tag. Otherwise expect a pile of useless `Script error.` cards — and
consider filtering them in `beforeSend`.

**React error boundary:**

```tsx
// src/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import bugboard from './lib/bugboard';

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    bugboard.criticalHigh(`React error: ${error.message}`, error, ['react']);
    // componentStack is the useful part; append it to the description yourself
    // if you want it: `${error.stack}\n\n${info.componentStack}`
  }

  render() {
    return this.state.hasError ? <p>Something went wrong</p> : this.props.children;
  }
}
```

**Vue:**

```ts
const app = createApp(App);

app.config.errorHandler = (err, instance, info) => {
  bugboard.critical(`Vue error: ${info}`, err, ['vue']);
};
```

Using `info` (Vue's lifecycle hook name — a small fixed set) in the title rather than the error
message keeps cards well-grouped.

**Svelte:** use `window.onerror` above; Svelte has no component-level error hook.

### Serverless: Lambda, Vercel, Cloudflare Workers, Deno

The rule is one line: **the queue will not drain itself, so await the flush.**

**AWS Lambda:**

```ts
import { createClient } from 'bugboard';

// Module scope: created once per container, reused across warm invocations.
const bugboard = createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  environment: process.env.STAGE,
});

export const handler = async (event) => {
  try {
    return { statusCode: 200, body: JSON.stringify(await process(event)) };
  } catch (err) {
    bugboard.criticalHigh('Lambda handler failed', err, ['lambda']);
    return { statusCode: 500, body: '{"error":"Internal Server Error"}' };
  } finally {
    await bugboard.flush();
  }
};
```

Module scope is right: the client is cheap to construct but there's no reason to rebuild it per
invocation, and a warm container reuses it. Because the drain timer only runs while the queue is
non-empty, an idle client between invocations schedules nothing and won't hold the container awake.

**Cloudflare Workers** — use `ctx.waitUntil()` so the response isn't delayed by the flush:

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const bugboard = createClient({
      keyId: env.BUGBOARD_KEY_ID,
      signingSecret: env.BUGBOARD_SIGNING_SECRET,
      environment: env.ENVIRONMENT,
    });

    try {
      return await handleRequest(request);
    } catch (err) {
      bugboard.criticalHigh('Worker request failed', err, ['workers']);
      return new Response('Internal Server Error', { status: 500 });
    } finally {
      ctx.waitUntil(bugboard.flush()); // response goes out now; flush finishes after
    }
  },
};
```

In Workers the client must be created *inside* `fetch` — bindings like `env` aren't available at
module scope. This is the one place the "build it once at module scope" rule doesn't apply.

**Vercel Edge Functions** work the same way, with `waitUntil` from `@vercel/functions`:

```ts
import { waitUntil } from '@vercel/functions';

export const config = { runtime: 'edge' };

export default async function handler(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    bugboard.criticalHigh('Edge function failed', err, ['vercel', 'edge']);
    return new Response('Error', { status: 500 });
  } finally {
    waitUntil(bugboard.flush());
  }
}
```

**Deno Deploy** has no `waitUntil` equivalent — plain `await bugboard.flush()` before returning.

### CLI tools and scripts

For a short-lived script, `beforeExit` handles it. The exception is an explicit `process.exit()`,
which skips `beforeExit` entirely and discards the queue:

```ts
#!/usr/bin/env node
import bugboard from './lib/bugboard';

async function main() {
  try {
    await runMigration();
  } catch (err) {
    bugboard.criticalHigh('Migration failed', err, ['cli', 'migration']);
    await bugboard.flush(); // required — process.exit() skips beforeExit
    process.exit(1);
  }
}

void main();
```

For a **long-running worker**, don't rely on the shutdown hook at all — it fires when the process
finally exits, which could be days away, and a worker that reports faster than it exits will hit
`maxQueueSize` (default 100) and start dropping. Flush per unit of work:

```ts
for await (const job of queue) {
  try {
    await job.handle();
  } catch (err) {
    bugboard.major(`Job failed: ${job.name}`, err, ['worker']);
  } finally {
    await bugboard.flush();
  }
}
```

---

## Configuration reference

| Option                | Type       | Default                | Purpose                                                                       |
| --------------------- | ---------- | ---------------------- | ----------------------------------------------------------------------------- |
| `apiKey`              | `string`   | —                      | Publishable key (`bb_pub_…`), bearer auth. Browser / client-side.             |
| `keyId`               | `string`   | —                      | Public key id (`bbk_…`) for HMAC auth. Servers.                               |
| `signingSecret`       | `string`   | —                      | Signing secret (`bb_sec_…`). Never transmitted.                               |
| `encryptionPublicKey` | `string`   | —                      | Base64 X25519 public key. When set, every payload is sealed in transit.       |
| `encryptionKeyId`     | `string`   | —                      | `bbek_…` id echoed in the envelope (enables key rotation).                    |
| `enabled`             | `boolean`  | `true`                 | Master switch. Forced to `false` when no credentials are set.                 |
| `environment`         | `string`   | —                      | Added to every card as tag `env:<value>`.                                     |
| `release`             | `string`   | —                      | Added to every card as tag `release:<value>`.                                 |
| `defaultTags`         | `string[]` | `[]`                   | Merged into every card's tags.                                                |
| `captureLocation`     | `boolean`  | `true`                 | Auto-capture the caller's file/line as `file_name`/`line_number`.             |
| `sampleRate`          | `number`   | `1.0`                  | Probability (0–1) a report is sent. Clamped into range.                       |
| `maxQueueSize`        | `number`   | `100`                  | Queue cap; overflow drops the **newest** report.                              |
| `concurrency`         | `number`   | `3`                    | Parallel in-flight requests when draining.                                    |
| `flushIntervalMs`     | `number`   | `2000`                 | Background drain cadence.                                                     |
| `timeoutMs`           | `number`   | `5000`                 | Per-request timeout.                                                          |
| `maxRetries`          | `number`   | `3`                    | Retries for 429/5xx/network errors (backoff + jitter, honors `Retry-After`).  |
| `beforeSend`          | `function` | —                      | Scrub or veto: return the payload, or `null` to drop it.                      |
| `debug`               | `boolean`  | `false`                | Verbose internal logging (keys always redacted).                              |
| `logLocally`          | `boolean`  | `false`                | Log each report instead of sending it (dry run).                              |
| `hideApiResponse`     | `boolean`  | `true`                 | Ask the server to omit the created card from its response.                    |
| `baseUrl`             | `string`   | `https://bugboard.dev` | Ingestion origin override. **Internal — for SDK tests.**                      |

### Tuning by runtime

The defaults suit a long-running server. Two situations call for adjustment:

**Serverless** — you're paying for wall-clock time on the flush, so cap the worst case:

```ts
createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  timeoutMs: 2000,
  maxRetries: 1,       // 3 retries × backoff can add seconds to every invocation
  flushIntervalMs: 500, // less to drain when the explicit flush arrives
});
```

**Browser** — a page that errors in a render loop can generate hundreds of reports:

```ts
createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,
  maxQueueSize: 30,  // bound memory; overflow drops the newest
  sampleRate: 0.5,   // if you have real volume
});
```

### Choosing a sample rate

Sampling is per report, evaluated before the payload is built
([`client.ts:45-48`](../src/client.ts#L45-L48)). Because dedup is server-side, sampling and dedup
interact usefully: at `sampleRate: 0.1`, a bug that happens 1000 times still reliably produces its
card — you just see an occurrence count of ~100. For a bug that happens *twice*, there's a good
chance you see nothing.

So: sample when your problem is volume from known-noisy paths, not to save quota generally. Start at
`1.0` and lower it once you can see what your traffic actually produces.

### `beforeSend` in detail

The hook receives the payload about to be sent and returns it (mutated or not), or `null` to drop
the report:

```ts
createClient({
  apiKey: '…',
  beforeSend: (payload) => {
    // Drop browser noise you can't act on
    if (payload.title.includes('Script error.')) return null;
    if (payload.title.includes('ResizeObserver loop')) return null;

    // Scrub emails and bearer tokens out of descriptions
    payload.description = payload.description
      ?.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
      .replace(/Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/g, 'Bearer [redacted]');

    // Route a subsystem's reports to a shared tag
    if (payload.tags.includes('billing')) payload.tags.push('team:payments');

    return payload;
  },
});
```

The payload shape is `ReportPayload` ([`types.ts:43-53`](../src/types.ts#L43-L53)) — `severity`,
`priority`, `title`, `tags`, plus optional `description`, `file_name`, `line_number`.

Keep the hook fast and total: it runs synchronously inside the reporting call. If it throws, the
report is lost and the error goes to the debug channel — the backstop catches it, so your app is
unaffected.

`hideApiResponse` is deliberately not in the payload; it's a header, so it stays out of reach of
`beforeSend` and stays readable when the body is encrypted.

---

## Payload encryption

By default, report bodies are plaintext JSON over TLS. That means they're readable in the browser's
network tab, and at any TLS-terminating proxy between you and BugBoard.

Set an encryption key and every payload is sealed with a libsodium sealed box (X25519) before it
leaves the client. The sealed envelope is opaque everywhere on the wire; only BugBoard holds the
private key.

```ts
export default createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,
  encryptionPublicKey: import.meta.env.VITE_BUGBOARD_ENCRYPTION_PUBLIC_KEY, // base64 X25519
  encryptionKeyId: import.meta.env.VITE_BUGBOARD_ENCRYPTION_KEY_ID,         // bbek_…
});
```

Nothing extra to install — the sealed-box binding ships with `bugboard` and is dynamically imported
the first time an encryption key is used, so it stays out of your bundle if you don't enable this.

Generate the keypair under **Settings → API Keys → Payload encryption**. The public key is safe to
embed in client code; the private key never leaves BugBoard. The `encryptionKeyId` is echoed in the
envelope so the server knows which key to decrypt with, which is what makes rotation possible.

Encryption happens before signing, so the HMAC covers the sealed bytes.

---

## TypeScript

Everything is typed, including all 16 method names:

```ts
import type {
  BugBoardClient,   // the client: 16 report methods + flush()
  BugBoardConfig,   // every option in the table above
  ReportPayload,    // what beforeSend receives and returns
  ReportFn,         // (title, description?, tags?) => void
  ReportMethodName, // 'critical' | 'criticalLow' | … the 16 names
  Severity,         // 'critical' | 'major' | 'moderate' | 'minor'
  Priority,         // 'low' | 'medium' | 'high'
  TagsInput,        // readonly string[] | string
} from 'bugboard';
```

`ReportMethodName` is a template literal type (`` `${Severity}${PrioritySuffix}` ``), so
`bugboard.criticalhigh(…)` is a compile error, not a runtime surprise. It's also useful for
mapping your own severity logic onto the client:

```ts
import type { BugBoardClient, ReportMethodName } from 'bugboard';

function severityFor(error: unknown): ReportMethodName {
  if (error instanceof DatabaseError) return 'criticalHigh';
  if (error instanceof NetworkError) return 'major';
  return 'moderate';
}

export function report(bugboard: BugBoardClient, title: string, error: unknown): void {
  bugboard[severityFor(error)](title, error);
}
```

Note that `description` is typed `unknown`, not `Error` — pass a caught value straight through
without narrowing it first. The SDK extracts message and stack when it is an `Error` and stringifies
anything else.

---

## Testing

### Turn it off

```ts
createClient({ apiKey: '…', enabled: process.env.NODE_ENV !== 'test' });
```

A client with no credentials is already disabled ([`config.ts:108-114`](../src/config.ts#L108-L114)),
so a test environment with no env vars is inert by default. Being explicit is still better — it
documents the intent and survives someone adding keys to CI.

### Dry run

```ts
createClient({ apiKey: '…', logLocally: true, debug: true });
```

Reports are logged instead of sent, which exercises the real config resolution, payload building,
and `beforeSend` without any network traffic. Good in staging, and good while developing a scrubber.

### Assert on what was reported

Give the injected client a spy shape rather than mocking the module:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { BugBoardClient } from 'bugboard';

function fakeClient() {
  return {
    critical: vi.fn(),
    criticalHigh: vi.fn(),
    major: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as BugBoardClient;
}

it('reports a failed payment', async () => {
  const bugboard = fakeClient();

  await new CheckoutService(bugboard).charge(failingOrder);

  expect(bugboard.criticalHigh).toHaveBeenCalledWith(
    'Payment capture failed',
    expect.any(Error),
    ['payments'],
  );
});
```

This is why passing the client as a dependency — rather than importing the shared module deep in
your call stack — is worth the small extra ceremony.

To test against the real client without hitting the network, point `baseUrl` at a local server (MSW,
`nock`, or a throwaway `http.createServer`) and `await flush()` before asserting. `baseUrl` is
marked internal for exactly this reason: it's a test seam, not a production knob.

---

## Troubleshooting

**Turn on `debug` first.** Nearly every question below is answered by one line of debug output:

```ts
createClient({ apiKey: '…', debug: true });
```

Output goes to the console. Keys are always redacted ([`client.ts:28`](../src/client.ts#L28)), so
debug output is safe to paste into an issue.

### Nothing arrives on the board

Work down this list:

1. **No credentials.** Debug prints `No credentials configured…` and the client is disabled. In a
   bundler, the usual cause is a missing prefix — `BUGBOARD_API_KEY` doesn't reach the browser;
   `VITE_`/`NEXT_PUBLIC_`/`PUBLIC_` does. Log the value at startup to confirm it isn't `undefined`.
2. **Never flushed.** Serverless, edge, a `process.exit()`, or a `SIGTERM`. See
   [Delivery and flushing](#delivery-and-flushing) — this is the most common cause on the server.
3. **`enabled: false`,** possibly via an `import.meta.env.PROD` guard while you're testing in dev.
4. **Sampled out.** Debug prints `Report sampled out.`
5. **Dropped by `beforeSend`.** Debug prints `Report dropped by beforeSend.`
6. **Queue full.** Debug prints `Queue full (100); report dropped (N dropped so far).`
7. **Quota exhausted.** The server accepted and dropped it — by design, and never retried.
8. **Auth rejected.** Debug shows a 401/403. Check the key is for the right project, hasn't been
   revoked, and is the right *type* — a secret key's `keyId` in the `apiKey` field will not work.

### Reports arrive but the card count doesn't go up

Your titles aren't stable — see [Core concepts](#core-concepts). URLs with ids, timestamps, or raw
`error.message` values containing variable data all produce a new card per occurrence. Use route
patterns (`/users/:id`) and move variable data into the description.

### The opposite: unrelated errors collapsing into one card

Titles are too generic. `'Request failed'` from four different call sites is one card. Add the
operation or subsystem while keeping it deterministic.

### A flood of `Script error.` cards

Cross-origin script errors, with no message and no stack. Serve your bundle with
`Access-Control-Allow-Origin` and add `crossorigin` to the `<script>` tag to get real errors; filter
them in `beforeSend` in the meantime.

### `ResizeObserver loop completed with undelivered notifications`

A benign browser warning that fires constantly on some layouts. Filter it in `beforeSend`.

### The process won't exit

The SDK isn't the cause: the drain timer is `unref()`'d and only runs while the queue is non-empty
([`queue.ts:33-38`](../src/queue.ts#L33-L38)), so it can't hold the event loop open. The
`beforeExit` hook does keep the process alive until an in-flight flush resolves — but that's bounded
by `timeoutMs` × `maxRetries`. If a shutdown is hanging for more than a few seconds, look elsewhere
(open server handles, database pools).

### Reports are slow to appear

They're batched — up to `flushIntervalMs` (default 2 s) plus request time, by design. If you need
one immediately, `await bugboard.flush()`.

### Bundle size grew more than expected

Check that you aren't importing the encryption path unintentionally. `tweetnacl-sealedbox-js` is
dynamically imported only when `encryptionPublicKey` is set. If your bundler is inlining that
dynamic import, make sure it isn't configured to disable code splitting.

---

## See also

- [README](../README.md) — quick start and installation
- [BugBoard API reference](https://bugboard.dev/docs/api-reference) — the wire contract
- [CONTRIBUTING.md](../CONTRIBUTING.md) — development setup
