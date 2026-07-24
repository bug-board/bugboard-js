# Next.js integration

Next.js runs your code in three places — server, browser, and edge/serverless — and each needs
different treatment. These are real files laid out at the paths a Next.js App Router app expects;
copy the ones you need into your project.

| File | Runs where | Key |
| --- | --- | --- |
| [`lib/bugboard.server.ts`](./lib/bugboard.server.ts) | Server only (guarded by `server-only`) | Secret |
| [`lib/bugboard.client.ts`](./lib/bugboard.client.ts) | Browser bundle | Publishable |
| [`app/api/checkout/route.ts`](./app/api/checkout/route.ts) | Route handler (may be serverless/edge) | Secret |
| [`app/error.tsx`](./app/error.tsx) | Client — recoverable route-segment errors | Publishable |
| [`app/global-error.tsx`](./app/global-error.tsx) | Client — root layout errors | Publishable |
| [`instrumentation.ts`](./instrumentation.ts) | Server — catches errors before redaction | Secret |

Two things to install and know:

- `npm i server-only` — makes a leaked secret key a **build** error rather than a shipped bundle.
- In production a server-component error reaching the client is redacted to a generic message plus a
  `digest`, so `error.message` in `error.tsx` is often unhelpful. The **useful** report is the
  server-side one from `instrumentation.ts` — that's why both exist.

These files import Next.js/React and use the `@/…` path alias, so they type-check inside a real
Next.js project, not standalone here.
