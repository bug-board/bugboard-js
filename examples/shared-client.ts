/**
 * The shared client module.
 * ═════════════════════════
 *
 * Demonstrates: creating ONE client and importing it everywhere.
 * Key type:     secret (server) — see the `.client` variant below for browsers.
 *
 * The client owns a queue, a drain timer, and a shutdown hook. Creating one per
 * file gives you N independent queues, N timers, and N shutdown hooks — so make
 * a single module that configures the client and import it across your app.
 *
 * In an app that has BOTH a server bundle and a browser bundle, make two
 * modules (shown at the bottom). Adopt whatever server-only convention your
 * framework enforces (`.server.ts`, `import 'server-only'`) so an accidental
 * client import fails at build time rather than shipping your signing secret.
 */

import { createClient } from 'bugboard';

// ─── Server module: src/lib/bugboard.ts ──────────────────────────────────────
// Uses a SECRET key (HMAC). The signing secret never travels on the wire.
const bugboard = createClient({
  keyId: process.env.BUGBOARD_KEY_ID, // bbk_…
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET, // bb_sec_…
  environment: process.env.NODE_ENV, // tags every card with env:<value>
  release: process.env.APP_VERSION, // tags every card with release:<value>
});

export default bugboard;

// Then, anywhere in your app:
//
//   import bugboard from './lib/bugboard';
//   bugboard.major('Checkout is slow');

// ─── Client module: src/lib/bugboard.client.ts ───────────────────────────────
// In a browser bundle, use a PUBLISHABLE key (bb_pub_…). It's public by design
// and write-only, so it's safe to embed. NEVER put keyId/signingSecret here.
//
//   import { createClient } from 'bugboard';
//
//   export default createClient({
//     apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,
//     environment: import.meta.env.MODE,
//   });
