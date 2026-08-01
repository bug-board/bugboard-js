import { resolveConfig } from './config';
import { takeInjectedLocation } from './injected-location';
import { captureLocation, locationFromError, type CapturedLocation } from './location';
import { createLogger } from './logger';
import { buildPayload } from './payload';
import { createQueue } from './queue';
import { createQuotaGate } from './quota';
import { registerShutdownFlush } from './shutdown';
import { enableNodeSourceMaps } from './sourcemaps-node';
import { createTransport } from './transport';
import type {
    BugBoardClient,
    BugBoardConfig,
    ReportFn,
    ReportMethodName,
    ReportPayload,
} from './types';
import { PRIORITY_SUFFIXES, SEVERITIES } from './types';

/**
 * Create a BugBoard client.
 *
 * The returned client exposes exactly the 16 severity×priority reporting
 * methods (`critical`, `criticalHigh`, `minorLow`, …) plus `flush()`. Every
 * reporting method is fire-and-forget: it returns immediately, delivery
 * happens on a background queue, and it **never throws** — a monitoring SDK
 * must not crash the app it monitors.
 *
 * @example
 * ```ts
 * const bugboard = createClient({ apiKey: import.meta.env.VITE_BUGBOARD_API_KEY });
 * bugboard.critical('Checkout failed', error, ['checkout']);
 * ```
 */
export function createClient(config: BugBoardConfig = {}): BugBoardClient {
    const { resolved, warnings } = resolveConfig(config);
    const logger = createLogger(resolved.debug, [config.signingSecret, config.apiKey]);
    for (const warning of warnings) logger.warn(warning);

    const quota = createQuotaGate(logger);
    const transport = createTransport(resolved, logger, quota);
    const queue = createQueue(resolved, transport, logger);
    registerShutdownFlush(queue);

    // On Node the maps are already on disk, so support is simply switched on.
    // Modules loaded before this point keep their bundled coordinates — see
    // `bugboard/preload` for covering the whole process.
    const nodeSourceMaps = resolved.nodeSourceMaps ? enableNodeSourceMaps() : 'unsupported';
    if (nodeSourceMaps !== 'unsupported') logger.debug(`Node source maps: ${nodeSourceMaps}.`);

    // Elsewhere — a browser — maps have to be fetched, so the work is deferred
    // to a report actually happening, and the module holding it is only loaded
    // if this is switched on.
    const browserSourceMaps = resolved.browserSourceMaps && nodeSourceMaps === 'unsupported';

    /** Correct a queued payload once its chunk's source map has been read. */
    async function resolveInBackground(
        payload: ReportPayload,
        location: CapturedLocation,
    ): Promise<void> {
        try {
            const { resolveViaSourceMap } = await import('./sourcemaps-browser');
            const mapped = await resolveViaSourceMap(location);
            if (!mapped) return;

            // A map gives an exact line, but the option governs the wire field
            // regardless of how good the answer is — a card either carries line
            // numbers or it does not.
            payload.file_name = mapped.file;
            if (resolved.lineNumbers) payload.line_number = mapped.line;
        } catch (error) {
            logger.debug('Source map resolution failed:', error);
        }
    }

    const report =
        (severity: (typeof SEVERITIES)[number], priority: 'low' | 'medium' | 'high'): ReportFn =>
        // Rest arguments rather than the declared `(title, description, tags)`:
        // a build plugin appends the call site as a trailing argument, and only
        // the runtime knows whether the last one is its own or the caller's.
        (title, ...rest) => {
            try {
                if (!resolved.enabled) return;

                // Checked here as well as in the transport so a suppressed
                // report costs nothing at all: no payload building, and no
                // queue slot that a deliverable report could have used.
                if (quota.shouldDiscard()) return;

                // Removes the injected argument if present, so `description`
                // and `tags` sit where the caller put them either way.
                const injected = takeInjectedLocation(rest);
                const [description, tags] = rest;

                // A reported error knows where it was thrown, which beats where
                // it was reported from — decisively so in a global handler,
                // where the call site is the one file every error in the app
                // would report. It outranks the plugin's location too: that one
                // is an exact answer to the same, less useful question.
                const thrown = resolved.captureLocation
                    ? locationFromError(description)
                    : undefined;

                // Otherwise a build plugin resolves the call site exactly, at
                // compile time, so prefer it and skip reading the stack
                // entirely. Failing that, capture the caller's file/line now,
                // while the user's frame is still on the synchronous call stack.
                const captured =
                    thrown === undefined && injected === undefined && resolved.captureLocation
                        ? captureLocation()
                        : undefined;
                const location = thrown ?? injected ?? captured;

                if (resolved.sampleRate < 1 && Math.random() >= resolved.sampleRate) {
                    logger.debug('Report sampled out.');
                    return;
                }

                let payload = buildPayload(
                    severity,
                    priority,
                    title,
                    description,
                    tags,
                    resolved,
                    location,
                );

                if (resolved.beforeSend) {
                    const result = resolved.beforeSend(payload);
                    if (result === null) {
                        logger.debug('Report dropped by beforeSend.');
                        return;
                    }
                    payload = result;
                }

                queue.enqueue(payload);

                // Enqueued first, then refined: resolving a browser source map
                // needs the network, and a report must never wait on — or be
                // lost to — that. If the map arrives before the queue drains,
                // the payload is corrected in place; if not, it ships with its
                // bundled coordinates.
                const bundled = thrown ?? captured;
                if (browserSourceMaps && bundled) {
                    void resolveInBackground(payload, bundled);
                }
            } catch (error) {
                // Absolute backstop: reporting must never throw into the host app.
                logger.error('Failed to queue report:', error);
            }
        };

    const client = {
        flush: () => queue.flush(),
    } as BugBoardClient;

    // Generate the 16 methods from the severity×priority table rather than
    // hand-writing them; the BugBoardClient type keeps them autocompletable.
    for (const severity of SEVERITIES) {
        for (const [suffix, priority] of Object.entries(PRIORITY_SUFFIXES)) {
            client[`${severity}${suffix}` as ReportMethodName] = report(severity, priority);
        }
    }

    return client;
}
