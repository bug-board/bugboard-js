import { resolveConfig } from './config';
import { createLogger } from './logger';
import { buildPayload } from './payload';
import { createQueue } from './queue';
import { registerShutdownFlush } from './shutdown';
import { createTransport } from './transport';
import type { BugBoardClient, BugBoardConfig, ReportFn, ReportMethodName } from './types';
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

    const transport = createTransport(resolved, logger);
    const queue = createQueue(resolved, transport, logger);
    registerShutdownFlush(queue);

    const report =
        (severity: (typeof SEVERITIES)[number], priority: 'low' | 'medium' | 'high'): ReportFn =>
        (title, description, tags) => {
            try {
                if (!resolved.enabled) return;
                if (resolved.sampleRate < 1 && Math.random() >= resolved.sampleRate) {
                    logger.debug('Report sampled out.');
                    return;
                }

                let payload = buildPayload(severity, priority, title, description, tags, resolved);

                if (resolved.beforeSend) {
                    const result = resolved.beforeSend(payload);
                    if (result === null) {
                        logger.debug('Report dropped by beforeSend.');
                        return;
                    }
                    payload = result;
                }

                queue.enqueue(payload);
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
