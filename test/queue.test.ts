import { describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../src/config';
import { createLogger } from '../src/logger';
import { createQueue } from '../src/queue';
import type { Transport } from '../src/transport';
import type { ReportPayload } from '../src/types';

const silentLogger = createLogger(false, []);

function makePayload(title: string): ReportPayload {
    return { severity: 'minor', priority: 'medium', title, tags: [] };
}

function queueWith(
    config: Parameters<typeof resolveConfig>[0],
    send: Transport['send'],
): ReturnType<typeof createQueue> {
    const { resolved } = resolveConfig({ apiKey: 'bb_pub_test', ...config });
    return createQueue(resolved, { send }, silentLogger);
}

describe('queue', () => {
    it('delivers everything on flush()', async () => {
        const sent: string[] = [];
        const queue = queueWith({}, (payload) => {
            sent.push(payload.title);
            return Promise.resolve();
        });

        queue.enqueue(makePayload('a'));
        queue.enqueue(makePayload('b'));
        await queue.flush();

        expect(sent).toEqual(['a', 'b']);
    });

    it('drops the newest report when the queue is full', async () => {
        const sent: string[] = [];
        const queue = queueWith({ maxQueueSize: 2 }, (payload) => {
            sent.push(payload.title);
            return Promise.resolve();
        });

        queue.enqueue(makePayload('a'));
        queue.enqueue(makePayload('b'));
        queue.enqueue(makePayload('overflow'));
        await queue.flush();

        expect(sent).toEqual(['a', 'b']);
    });

    it('drains with bounded concurrency', async () => {
        let active = 0;
        let peak = 0;
        const queue = queueWith({ concurrency: 2 }, async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
        });

        for (let i = 0; i < 6; i++) queue.enqueue(makePayload(`r${i}`));
        await queue.flush();

        expect(peak).toBeLessThanOrEqual(2);
        expect(peak).toBeGreaterThan(0);
    });

    it('survives transport failures without throwing', async () => {
        const queue = queueWith({}, () => Promise.reject(new Error('boom')));

        queue.enqueue(makePayload('a'));
        await expect(queue.flush()).resolves.toBeUndefined();
    });

    it('drains in the background on the flush interval', async () => {
        vi.useFakeTimers();
        try {
            const sent: string[] = [];
            const queue = queueWith({ flushIntervalMs: 50 }, (payload) => {
                sent.push(payload.title);
                return Promise.resolve();
            });

            queue.enqueue(makePayload('a'));
            expect(sent).toEqual([]); // nothing sent synchronously

            await vi.advanceTimersByTimeAsync(60);
            expect(sent).toEqual(['a']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('flushSync fires keepalive sends for everything buffered', async () => {
        const calls: Array<{ title: string; keepalive?: boolean }> = [];
        const queue = queueWith({}, (payload, options) => {
            calls.push({ title: payload.title, keepalive: options?.keepalive });
            return Promise.resolve();
        });

        queue.enqueue(makePayload('a'));
        queue.enqueue(makePayload('b'));
        queue.flushSync();
        await queue.flush(); // settle the fired promises

        expect(calls).toEqual([
            { title: 'a', keepalive: true },
            { title: 'b', keepalive: true },
        ]);
    });
});
