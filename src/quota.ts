import type { Logger } from './logger';

/**
 * Why the server accepted a report and threw it away — the `reason` field of
 * the drop envelope (API reference §6.1).
 *
 * `unknown` is not a wire value: it stands for a `reason` this SDK version
 * doesn't recognize, which a newer server may well send.
 */
export type DropReason = 'quota' | 'paused' | 'archived' | 'unknown';

/**
 * How long a non-quota drop suppresses for.
 *
 * `paused` and `archived` are lifecycle states a human flips in the dashboard,
 * so unlike a quota window they have no predictable end. Half an hour is long
 * enough to stop a busy app hammering an endpoint that is discarding
 * everything, and short enough that un-pausing a project doesn't cost a day of
 * reports. An unrecognized reason gets the same treatment: without knowing what
 * it means, the short window is the one that can't do much damage.
 */
const LIFECYCLE_SUPPRESSION_MS = 30 * 60 * 1000;

/**
 * When the account's allowance next refills.
 *
 * The server anchors the account-wide pool to UTC and rolls it at midnight
 * (`QuotaPeriod::Daily`), whatever timezones the owner's projects span, so this
 * is exact rather than a guess.
 *
 * One caveat: the server's per-project containment cap rolls at the *project's*
 * own midnight but reports the same `reason: "quota"`, so a drop caused by that
 * cap can suppress past its real reset. That trade is deliberate — the cap is an
 * abuse ceiling that a normal project never reaches, and the alternative is
 * guessing a timezone the SDK isn't told.
 */
function nextUtcMidnight(now: number): number {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function suppressionUntil(reason: DropReason, now: number): number {
    return reason === 'quota' ? nextUtcMidnight(now) : now + LIFECYCLE_SUPPRESSION_MS;
}

function describe(reason: DropReason): string {
    switch (reason) {
        case 'quota':
            return "the project owner's event allowance is exhausted";
        case 'paused':
            return 'the project is paused';
        case 'archived':
            return 'the project is archived';
        default:
            return 'the server is discarding reports';
    }
}

/**
 * Read the drop envelope from a 2xx body.
 *
 * `dropped` + `reason` is the current contract; `quota_exceeded` is a legacy
 * alias the server still ships alongside it, and is all an older server sends.
 * Either flag means the report was accepted and discarded.
 */
export function readDropReason(body: Record<string, unknown>): DropReason | undefined {
    if (body.dropped !== true && body.quota_exceeded !== true) return undefined;

    const reason = body.reason;
    if (reason === 'quota' || reason === 'paused' || reason === 'archived') return reason;

    // No `reason` at all means an older server, where the legacy flag only ever
    // meant a spent allowance. A `reason` we don't recognize is a newer server
    // saying something this version can't interpret.
    return reason === undefined ? 'quota' : 'unknown';
}

export interface QuotaGate {
    /**
     * Whether reports should be discarded locally right now. Counts the
     * discard, so call it once per report.
     */
    shouldDiscard(): boolean;
    /** Arm the gate after the server discarded a report. */
    arm(reason: DropReason): void;
}

/**
 * Client-side suppression for reports the server would only discard.
 *
 * Once the server says it is dropping reports, sending more of them achieves
 * nothing: the response is a 200 the SDK is contractually forbidden from
 * retrying, so every further report is a wasted round trip from inside the
 * customer's app. The gate closes for as long as the drop is expected to last
 * and reports are discarded before they reach the network.
 *
 * It re-opens on its own, and the first report through afterwards is an
 * ordinary send — if nothing has changed the server drops it again and re-arms
 * the gate, costing one request per window rather than one per report.
 *
 * State is per client instance and per process. That covers long-lived
 * processes (Node servers, workers, a browser page); a runtime that builds a
 * fresh client per request starts with an open gate every time, which is why
 * the PHP SDK can additionally persist this through a PSR-16 store.
 */
export function createQuotaGate(logger: Logger, now: () => number = Date.now): QuotaGate {
    let until: number | undefined;
    let discarded = 0;

    return {
        shouldDiscard() {
            if (until === undefined) return false;

            if (now() >= until) {
                // The window has passed. Re-open and let this report through as
                // the probe that finds out whether anything changed.
                logger.debug(
                    `Quota suppression lifted after discarding ${discarded} report(s) locally.`,
                );
                until = undefined;
                discarded = 0;
                return false;
            }

            discarded += 1;
            logger.debug(
                `Report discarded locally: suppressed until ${new Date(until).toISOString()} (${discarded} so far).`,
            );
            return true;
        },

        arm(reason) {
            const next = suppressionUntil(reason, now());

            // Only announce a gate that is actually closing further than it
            // already was — a burst of in-flight reports all landing on the same
            // drop must not produce a burst of identical warnings.
            if (until !== undefined && next <= until) return;

            until = next;
            logger.warn(
                `Report dropped by the server: ${describe(reason)}. ` +
                    `Suppressing reports locally until ${new Date(next).toISOString()}.`,
            );
        },
    };
}
