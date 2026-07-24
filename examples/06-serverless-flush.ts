/**
 * Flushing on serverless and edge runtimes.
 * ═════════════════════════════════════════
 *
 * Demonstrates: the ONE rule that differs by runtime — the queue won't drain
 *               itself when the runtime can freeze or kill you on return, so you
 *               must flush explicitly.
 * Key type:     secret (server-side).
 *
 * There is no process-wide lifecycle hook on serverless/edge, and the runtime
 * may freeze or terminate your invocation the instant you return a response.
 * A report you just made has NOT been sent yet — it's on a background queue.
 * So: always await the flush before returning (or hand it to `waitUntil`).
 *
 * `flush()` on an empty queue is effectively free, so an unconditional `finally`
 * is the right shape — you don't need to track whether you reported anything.
 */

import { createClient } from 'bugboard';

// ─── AWS Lambda ───────────────────────────────────────────────────────────────
// Module scope: created once per container, reused across warm invocations. The
// drain timer only runs while the queue is non-empty, so an idle client between
// invocations schedules nothing and won't hold the container awake.
const bugboard = createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
  environment: process.env.STAGE,
  // Serverless tuning: you pay wall-clock time for the flush, so cap the worst case.
  timeoutMs: 2000,
  maxRetries: 1,
  flushIntervalMs: 500,
});

export const lambdaHandler = async (event: unknown) => {
  try {
    return { statusCode: 200, body: JSON.stringify(await process(event)) };
  } catch (err) {
    bugboard.criticalHigh('Lambda handler failed', err, ['lambda']);
    return { statusCode: 500, body: '{"error":"Internal Server Error"}' };
  } finally {
    await bugboard.flush(); // runs on both the success and error paths
  }
};

// ─── Cloudflare Workers ───────────────────────────────────────────────────────
// Use ctx.waitUntil() so the response isn't delayed by the flush. NOTE: in
// Workers the client must be created INSIDE fetch — bindings like `env` aren't
// available at module scope. This is the one place the "build once" rule breaks.
export const workerHandler = {
  async fetch(request: Request, env: Record<string, string>, ctx: ExecutionContext): Promise<Response> {
    const bb = createClient({
      keyId: env.BUGBOARD_KEY_ID,
      signingSecret: env.BUGBOARD_SIGNING_SECRET,
      environment: env.ENVIRONMENT,
    });

    try {
      return await handleRequest(request);
    } catch (err) {
      bb.criticalHigh('Worker request failed', err, ['workers']);
      return new Response('Internal Server Error', { status: 500 });
    } finally {
      ctx.waitUntil(bb.flush()); // response goes out now; flush finishes after
    }
  },
};

// ─── Vercel Edge Functions ────────────────────────────────────────────────────
// Same idea, with `waitUntil` from '@vercel/functions':
//
//   import { waitUntil } from '@vercel/functions';
//   export const config = { runtime: 'edge' };
//   export default async function handler(request: Request) {
//     try { return await handle(request); }
//     catch (err) { bugboard.criticalHigh('Edge function failed', err, ['vercel', 'edge']); return new Response('Error', { status: 500 }); }
//     finally { waitUntil(bugboard.flush()); }
//   }

// ─── Deno Deploy ──────────────────────────────────────────────────────────────
// No `waitUntil` equivalent — plain `await bugboard.flush()` before returning.

// ─── Stubs / minimal types so this file stands alone ──────────────────────────
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
async function process(_event: unknown): Promise<unknown> {
  return {};
}
async function handleRequest(_request: Request): Promise<Response> {
  return new Response('ok');
}
