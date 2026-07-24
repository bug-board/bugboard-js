/**
 * Sampling and per-runtime tuning.
 * ════════════════════════════════
 *
 * Demonstrates: the knobs that control volume, memory, and latency.
 * Key type:     any.
 *
 * The defaults suit a long-running server. Two situations call for adjustment:
 * a browser that can error in a render loop, and a serverless function where
 * you pay wall-clock time for the flush. Everything here is optional.
 */

import { createClient } from 'bugboard';

// ─── Browser: a render loop can produce hundreds of reports ───────────────────
export const browserClient = createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,

  // Bound memory; overflow drops the NEWEST report (counted in debug output).
  maxQueueSize: 30,

  // Sampling is per report, evaluated before the payload is even built. Because
  // dedup is server-side, a bug that happens 1000 times still reliably produces
  // its card at sampleRate 0.1 — you just see an occurrence count of ~100. A bug
  // that happens twice, though, may vanish. So sample for volume, not to save
  // quota generally. Start at 1.0 and lower it once you see real traffic.
  sampleRate: 0.5,
});

// ─── Serverless: cap the worst-case flush time ────────────────────────────────
export const serverlessClient = createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,

  timeoutMs: 2000, // per-request timeout (default 5000)
  maxRetries: 1, // 3 retries × backoff can add seconds to every invocation
  flushIntervalMs: 500, // less to drain when the explicit flush arrives
});

// ─── Long-running server: the defaults are already right ──────────────────────
export const serverClient = createClient({
  keyId: process.env.BUGBOARD_KEY_ID,
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET,

  // Shown for reference — these ARE the defaults:
  maxQueueSize: 100, // queue cap
  concurrency: 3, // parallel in-flight requests when draining
  flushIntervalMs: 2000, // background drain cadence
  timeoutMs: 5000, // per-request timeout
  maxRetries: 3, // retries for 429/5xx/network (backoff + jitter, honors Retry-After)
  sampleRate: 1.0, // send everything
});
