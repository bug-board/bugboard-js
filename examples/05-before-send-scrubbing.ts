/**
 * Scrub PII, drop noise, and route reports with `beforeSend`.
 * ══════════════════════════════════════════════════════════
 *
 * Demonstrates: the last-mile hook that sees every report right before it's sent.
 * Key type:     any.
 *
 * `beforeSend` receives the built payload and returns it (mutated or not), or
 * `null` to drop the report entirely. It's your single point for redaction and
 * filtering — it sees every report regardless of where in your app it came from.
 *
 * By the time the hook runs, `payload.description` is already a STRING (whatever
 * you passed has been serialized), so a scrubber can treat it as text.
 *
 * Keep the hook fast and total: it runs synchronously inside the reporting call.
 * If it throws, that one report is lost and the error goes to the debug channel —
 * the backstop catches it, so your app is unaffected. But don't rely on that.
 */

import { createClient, type ReportPayload } from 'bugboard';

const bugboard = createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,

  beforeSend: (payload: ReportPayload): ReportPayload | null => {
    // 1. Drop browser noise you can't act on.
    if (payload.title.includes('Script error.')) return null;
    if (payload.title.includes('ResizeObserver loop')) return null;

    // 2. Scrub emails and bearer tokens out of the description.
    if (payload.description) {
      payload.description = payload.description
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
        .replace(/Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/g, 'Bearer [redacted]');
    }

    // 3. Route a subsystem's reports to a shared team tag.
    if (payload.tags.includes('billing')) payload.tags.push('team:payments');

    // Return the (mutated) payload to send it.
    return payload;
  },
});

// `hideApiResponse` (default true) is deliberately NOT in the payload — it's a
// header, so it stays out of reach of beforeSend and readable when encrypted.

export default bugboard;

/*
 * The payload shape (ReportPayload):
 *   { severity, priority, title, tags, description?, file_name?, line_number? }
 *
 * `beforeSend` is also great to develop against with a dry run — combine it with
 * `logLocally: true` so you can see exactly what your scrubber produces without
 * sending anything. See 11-testing.ts.
 */
