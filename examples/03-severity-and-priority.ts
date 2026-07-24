/**
 * All 16 reporting methods, and what the description accepts.
 * ══════════════════════════════════════════════════════════
 *
 * Demonstrates: the full reporting surface and the kinds of value you can pass
 *               as a description.
 * Key type:     any (this file uses logLocally so it needs no real credentials).
 * Run it:       npx tsx examples/03-severity-and-priority.ts
 *
 * There is no `report()` method — the METHOD NAME is the classification. The
 * client exposes exactly 16 methods, one per severity×priority pair. A bare
 * severity name is the medium-priority variant.
 *
 *              low            medium (default)               high
 *   critical   criticalLow    critical / criticalMedium      criticalHigh
 *   major      majorLow       major    / majorMedium         majorHigh
 *   moderate   moderateLow    moderate / moderateMedium      moderateHigh
 *   minor      minorLow       minor    / minorMedium         minorHigh
 *
 * Every method takes the same arguments: (title, description?, tags?).
 * Most apps only ever use the four medium methods.
 */

import { createClient } from 'bugboard';

// `logLocally` prints reports instead of sending them, so this runs with no key.
const bugboard = createClient({ apiKey: 'bb_pub_demo', logLocally: true, debug: true });

// ─── The four you'll actually use ─────────────────────────────────────────────
bugboard.critical('Payment provider returned 500');
bugboard.major('Checkout is slow');
bugboard.moderate('Image thumbnail failed to generate');
bugboard.minor('Tooltip is misaligned on Safari');

// ─── Priority variants (Low / Medium / High) ──────────────────────────────────
bugboard.criticalHigh('Database connection pool exhausted');
bugboard.criticalLow('Feature flag lookup fell back to default');
bugboard.majorHigh('Search index is stale by > 1 hour');
bugboard.minorLow('Deprecated API parameter used');

// ─── Arguments: (title, description?, tags?) ──────────────────────────────────

// Tags accept an array…
bugboard.major('Stripe webhook signature verification failed', undefined, ['payments', 'stripe']);
// …or a CSV string.
bugboard.major('Stripe webhook signature verification failed', undefined, 'payments,stripe');

// ─── What the description accepts: pass whatever you already have ──────────────

// A string — used unchanged.
bugboard.minor('Cache miss', 'redis key user:profile:42 was cold');

// An Error — contributes its message + stack, no duplication.
try {
  JSON.parse('{ not json');
} catch (err) {
  bugboard.major('Failed to parse config', err, ['config']);
}

// An object or array — pretty-printed JSON. No need to JSON.stringify first.
bugboard.major('Validation failed', {
  userId: 42,
  cart: [{ sku: 'ABC', qty: 2 }],
  errors: { email: 'required' },
});

// A scalar — stringified (`true`, `0`, `1.5`, `NaN`, …).
bugboard.moderate('Retry budget consumed', 0);

// An Error NESTED inside a context object still contributes its full stack —
// a plain JSON.stringify would drop it (message/stack are non-enumerable).
try {
  throw new Error('capture declined');
} catch (caught) {
  bugboard.minor('Checkout step failed', { step: 'capture', err: caught });
}

// ─── Dedup: keep the title stable ─────────────────────────────────────────────
const requestId = 'req_abc123';

// Bad — a new card per request, forever. Don't do this.
// bugboard.major(`Webhook ${requestId} failed at ${Date.now()}`);

// Good — one card whose occurrence count climbs; variable data in the description.
bugboard.major('Webhook processing failed', { requestId, at: Date.now() });

await bugboard.flush(); // this script exits, so force delivery of the (logged) reports
