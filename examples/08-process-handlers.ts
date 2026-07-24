/**
 * Catching process-level failures in Node.
 * ════════════════════════════════════════
 *
 * Demonstrates: reporting what escapes your framework — unhandled rejections,
 *               uncaught exceptions, and termination signals.
 * Key type:     secret (server-side).
 *
 * Your framework's error handler catches errors inside a request. These handlers
 * catch everything else. The subtle part is flushing: on the crash and signal
 * paths, `beforeExit` does NOT fire, so the report describing WHY you crashed —
 * the single most valuable one you'll ever queue — would be discarded unless you
 * flush it yourself.
 */

import bugboard from './shared-client';

// ─── Rejected promises with no .catch() ───────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  bugboard.criticalHigh('Unhandled promise rejection', reason, ['process']);
});

// ─── Uncaught synchronous exceptions ──────────────────────────────────────────
process.on('uncaughtException', (err) => {
  bugboard.criticalHigh('Uncaught exception', err, ['process']);

  // The process is now in an undefined state. Flush, THEN let it die — a plain
  // process.exit() here would throw away the report we just queued.
  void bugboard.flush().finally(() => process.exit(1));
});

// ─── Termination signals (containers get SIGTERM on every deploy) ─────────────
// `beforeExit` doesn't fire on signals either. If you have an HTTP server, close
// it first (see 02-node-server-hmac.ts); here is the minimal signal-only case.
async function onSignal(signal: string): Promise<void> {
  await bugboard.flush(); // deliver anything queued before we go
  process.exit(0);
}

process.on('SIGTERM', () => void onSignal('SIGTERM'));
process.on('SIGINT', () => void onSignal('SIGINT'));
