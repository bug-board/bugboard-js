/**
 * Browser SPA with a publishable key.
 * ═══════════════════════════════════
 *
 * Demonstrates: the simplest client-side setup — a publishable key plus global
 *               handlers that catch what your components miss.
 * Key type:     publishable (bb_pub_…), sent as a bearer token.
 * Runs in:      any bundled browser app (Vite, webpack, etc.). This file is
 *               meant to be bundled and loaded via a <script type="module">.
 *
 * A publishable key is public by design and write-only — it's fine that anyone
 * can read it out of your JS bundle. The worst they can do is create cards on
 * your board. NEVER put a secret key (keyId/signingSecret) in browser code.
 *
 * Delivery: the SDK flushes automatically on `pagehide` using keepalive
 * requests, so you don't normally call flush() in a browser. Do flush before a
 * deliberate `location.assign(...)` if you just reported something.
 */

import { createClient } from 'bugboard';

// Read the key from your bundler's client-exposed env (VITE_, NEXT_PUBLIC_, …).
const bugboard = createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY, // bb_pub_…
  environment: import.meta.env.MODE, // 'development' | 'production'
  release: __APP_VERSION__, // optional, via a vite `define`

  // Don't report from local dev — only ship reports from a production build.
  enabled: import.meta.env.PROD,

  // A render loop can generate hundreds of reports; bound memory and sample.
  maxQueueSize: 30,
});

// ─── Global handlers: catch what your component tree doesn't ──────────────────

// Synchronous errors that bubble to the window.
window.addEventListener('error', (event) => {
  // Keep the title stable: `event.message` is a small, well-grouped string.
  bugboard.critical(`Uncaught: ${event.message}`, event.error, ['browser']);
});

// Rejected promises with no .catch().
window.addEventListener('unhandledrejection', (event) => {
  bugboard.critical('Unhandled promise rejection', event.reason, ['browser']);
});

// ─── Reporting from your own code ─────────────────────────────────────────────

async function submitOrder(payload: unknown): Promise<void> {
  try {
    const res = await fetch('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`Order API returned ${res.status}`);
  } catch (err) {
    // Fire-and-forget: no `await`, returns void immediately.
    bugboard.major('Order submission failed', err, ['checkout']);
    throw err; // still handle the failure in your UI
  }
}

export { bugboard, submitOrder };

/*
 * A note on cross-origin scripts:
 *
 * Browsers report cross-origin script errors as the opaque string "Script error."
 * with no stack. To get real messages from a CDN-hosted bundle, serve it with
 * `Access-Control-Allow-Origin` and add `crossorigin` to the <script> tag.
 * Filter the noise in the meantime — see 05-before-send-scrubbing.ts.
 *
 * `__APP_VERSION__` is a compile-time constant you inject via your bundler; if
 * you don't need `release`, drop it (and the `declare` below).
 */
declare const __APP_VERSION__: string;
