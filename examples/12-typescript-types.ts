/**
 * Using the exported types.
 * ═════════════════════════
 *
 * Demonstrates: mapping your own severity logic onto the client with the
 *               exported types, and typing dependency injection.
 * Key type:     any.
 * Run it:       npx tsx examples/12-typescript-types.ts
 *
 * Everything is typed, including all 16 method names. `ReportMethodName` is a
 * template literal type (`${Severity}${PrioritySuffix}`), so `criticalhigh`
 * (wrong casing) is a COMPILE error, not a runtime surprise — and it's useful
 * for mapping your own logic onto the client.
 */

import {
  createClient,
  type BugBoardClient,
  type ReportMethodName,
  type Severity,
} from 'bugboard';

// Custom error classes to branch on.
class DatabaseError extends Error {}
class NetworkError extends Error {}

// Map an error to one of the 16 method names. The return type constrains you to
// a real method name — a typo won't compile.
function severityFor(error: unknown): ReportMethodName {
  if (error instanceof DatabaseError) return 'criticalHigh';
  if (error instanceof NetworkError) return 'major';
  return 'moderate';
}

// A reusable reporter. `description` is typed `unknown` (not `Error`) on purpose:
// pass a caught value straight through without narrowing it first. The SDK
// extracts message/stack from an Error, pretty-prints objects, stringifies rest.
export function report(bugboard: BugBoardClient, title: string, error: unknown): void {
  bugboard[severityFor(error)](title, error);
}

// ─── Demo ─────────────────────────────────────────────────────────────────────
const bugboard = createClient({ apiKey: 'bb_pub_demo', logLocally: true });

report(bugboard, 'Query timed out', new DatabaseError('deadlock')); // → criticalHigh
report(bugboard, 'Upstream unreachable', new NetworkError('ECONNRESET')); // → major
report(bugboard, 'Something odd happened', new Error('???')); // → moderate

// You can also enumerate severities in typed code:
const allSeverities: readonly Severity[] = ['critical', 'major', 'moderate', 'minor'];
for (const s of allSeverities) {
  bugboard[s](`Health check: ${s} path exercised`);
}

await bugboard.flush();
