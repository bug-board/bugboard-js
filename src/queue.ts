import type { ResolvedConfig } from './config';
import type { Logger } from './logger';
import type { Transport } from './transport';
import type { ReportPayload } from './types';

export interface Queue {
    /** Buffer a report for background delivery. Never throws. */
    enqueue(payload: ReportPayload): void;
    /** Drain everything and wait for in-flight requests. Safe to call any time. */
    flush(): Promise<void>;
    /** Best-effort synchronous drain for page unload: fire keepalive sends, no waiting. */
    flushSync(): void;
}

/**
 * Bounded background queue.
 *
 * Reports are buffered and drained on a timer with bounded concurrency, so a
 * burst of errors never floods the API (or self-inflicts a 429) and reporting
 * never blocks the host app. On overflow the **newest** report is dropped —
 * the oldest reports are already queued and likelier to describe the root
 * cause. The drain timer only runs while the queue is non-empty, so idle
 * clients schedule nothing (important for serverless).
 */
export function createQueue(config: ResolvedConfig, transport: Transport, logger: Logger): Queue {
    const buffer: ReportPayload[] = [];
    const inFlight = new Set<Promise<void>>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let droppedCount = 0;

    function startTimer(): void {
        if (timer !== undefined) return;
        timer = setInterval(() => {
            void drain();
        }, config.flushIntervalMs);
        // In Node, a pending drain timer must not keep the process alive.
        (timer as { unref?: () => void }).unref?.();
    }

    function stopTimer(): void {
        if (timer === undefined) return;
        clearInterval(timer);
        timer = undefined;
    }

    function dispatch(payload: ReportPayload, keepalive = false): Promise<void> {
        const request = transport
            .send(payload, keepalive ? { keepalive: true } : undefined)
            .catch((error: unknown) => {
                logger.error('Failed to deliver report:', error);
            });
        inFlight.add(request);
        void request.finally(() => inFlight.delete(request));
        return request;
    }

    async function drain(): Promise<void> {
        while (buffer.length > 0) {
            const batch = buffer.splice(0, config.concurrency);
            await Promise.all(batch.map((payload) => dispatch(payload)));
        }
        stopTimer();
    }

    return {
        enqueue(payload) {
            if (buffer.length >= config.maxQueueSize) {
                droppedCount += 1;
                logger.warn(
                    `Queue full (${config.maxQueueSize}); report dropped (${droppedCount} dropped so far).`,
                );
                return;
            }
            buffer.push(payload);
            startTimer();
        },

        async flush() {
            await drain();
            await Promise.all([...inFlight]);
        },

        flushSync() {
            stopTimer();
            while (buffer.length > 0) {
                const payload = buffer.shift();
                if (payload) void dispatch(payload, true);
            }
        },
    };
}
