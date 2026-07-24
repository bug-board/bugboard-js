/**
 * Node server with a secret key (HMAC).
 * ═════════════════════════════════════
 *
 * Demonstrates: server-side reporting with a secret key, wired into an Express
 *               error handler, plus a SIGTERM flush for clean container deploys.
 * Key type:     secret (keyId + signingSecret). The signing secret is used to
 *               compute an HMAC over the body and NEVER travels on the wire.
 * Runs in:      any long-running Node 20+ server (Express, Fastify, Koa, …).
 *
 * Delivery: a long-running server is the easy case. Reports drain on a
 * background timer, and the SDK's `beforeExit` hook flushes when the event loop
 * empties. The one gap is signals — `beforeExit` does NOT fire on SIGTERM,
 * which a container gets on every deploy — so flush in your shutdown handler.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { createClient } from 'bugboard';

const bugboard = createClient({
  keyId: process.env.BUGBOARD_KEY_ID, // bbk_…
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET, // bb_sec_…  (never transmitted)
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
});

const app = express();

app.get('/orders/:id', async (req, res) => {
  const order = await lookupOrder(req.params.id);
  res.json(order);
});

// ─── Express error middleware: MUST have four parameters ──────────────────────
// Express only treats a middleware as an error handler if it declares all four.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  bugboard.criticalHigh(
    // Use the route PATTERN (`/orders/:id`), not the URL (`/orders/91847`), or
    // you'll create a new card per id. This is the single most valuable habit.
    `Unhandled error: ${req.method} ${req.route?.path ?? 'unknown route'}`,
    err,
    ['express', 'unhandled'],
  );

  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(3000);

// ─── Flush on shutdown so in-flight reports survive a rolling restart ─────────
async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, draining…`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await bugboard.flush(); // deliver anything queued before we exit
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// ─── Stub ─────────────────────────────────────────────────────────────────────
async function lookupOrder(id: string): Promise<{ id: string }> {
  return { id };
}

/*
 * Fastify and Koa are the same shape — build the client at module scope, report
 * from the framework's error hook, filter out 4xx (client mistakes, not bugs):
 *
 *   fastify.setErrorHandler((error, request, reply) => {
 *     if ((error.statusCode ?? 500) >= 500) {
 *       bugboard.criticalHigh(`Unhandled error: ${request.method} ${request.routeOptions.url}`, error, ['fastify']);
 *     }
 *     reply.status(error.statusCode ?? 500).send({ error: 'Internal Server Error' });
 *   });
 */
