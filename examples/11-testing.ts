/**
 * Testing: fake clients, dry runs, and disabling.
 * ═══════════════════════════════════════════════
 *
 * Demonstrates: three ways to keep BugBoard out of your test's way while still
 *               asserting on what your code reports.
 * Key type:     none needed.
 *
 * The cleanest testable design passes the client in as a dependency rather than
 * importing the shared module deep in your call stack — then a test can hand you
 * a spy and assert on it.
 */

import { describe, expect, it, vi } from 'vitest';
import { createClient, type BugBoardClient } from 'bugboard';

// ─── 1. Turn it off ───────────────────────────────────────────────────────────
// A client with no credentials is already disabled, so a test env with no keys
// is inert by default. Being explicit is still better — it documents intent and
// survives someone adding keys to CI.
export const testClient = createClient({
  apiKey: process.env.BUGBOARD_API_KEY,
  enabled: process.env.NODE_ENV !== 'test',
});

// ─── 2. Dry run ───────────────────────────────────────────────────────────────
// Exercise the REAL config resolution, payload building, and beforeSend without
// any network traffic — reports are logged instead of sent. Great for staging
// and while developing a scrubber.
export const dryRunClient = createClient({
  apiKey: 'bb_pub_demo',
  logLocally: true,
  debug: true,
});

// ─── 3. Assert on what was reported ───────────────────────────────────────────
// Give the injected client a spy shape rather than mocking the module.
function fakeClient() {
  return {
    critical: vi.fn(),
    criticalHigh: vi.fn(),
    major: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as BugBoardClient;
}

// A unit under test that takes the client as a dependency.
class CheckoutService {
  constructor(private readonly bugboard: BugBoardClient) {}

  async charge(order: { failing: boolean }): Promise<void> {
    try {
      if (order.failing) throw new Error('card declined');
    } catch (err) {
      this.bugboard.criticalHigh('Payment capture failed', err, ['payments']);
    }
  }
}

describe('CheckoutService', () => {
  it('reports a failed payment', async () => {
    const bugboard = fakeClient();

    await new CheckoutService(bugboard).charge({ failing: true });

    expect(bugboard.criticalHigh).toHaveBeenCalledWith('Payment capture failed', expect.any(Error), [
      'payments',
    ]);
  });
});

/*
 * To test against the REAL client without hitting the network, point `baseUrl`
 * at a local server (MSW, nock, or a throwaway http.createServer) and
 * `await flush()` before asserting. `baseUrl` is marked internal for exactly
 * this reason: it's a test seam, not a production knob.
 */
