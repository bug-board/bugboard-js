import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../src/logger';
import { createQuotaGate, readDropReason } from '../src/quota';
import { createTransport } from '../src/transport';
import { resolveConfig } from '../src/config';
import type { ReportPayload } from '../src/types';

const payload: ReportPayload = {
    severity: 'major',
    priority: 'medium',
    title: 'SDK smoke test',
    tags: [],
};

const silentLogger = createLogger(false, []);

function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('readDropReason', () => {
    it('reads the current dropped + reason contract', () => {
        expect(readDropReason({ dropped: true, reason: 'quota' })).toBe('quota');
        expect(readDropReason({ dropped: true, reason: 'paused' })).toBe('paused');
        expect(readDropReason({ dropped: true, reason: 'archived' })).toBe('archived');
    });

    it('treats the bare legacy flag as a quota drop', () => {
        // An older server sends only `quota_exceeded`, which never meant
        // anything but a spent allowance.
        expect(readDropReason({ quota_exceeded: true })).toBe('quota');
    });

    it('does not trust an unrecognized reason from a newer server', () => {
        expect(readDropReason({ dropped: true, reason: 'something_new' })).toBe('unknown');
    });

    it('returns undefined for a normal success', () => {
        expect(readDropReason({})).toBeUndefined();
        expect(readDropReason({ deduplicated: true })).toBeUndefined();
        expect(readDropReason({ dropped: false, quota_exceeded: false })).toBeUndefined();
    });
});

describe('createQuotaGate', () => {
    it('is open until something arms it', () => {
        const gate = createQuotaGate(silentLogger);
        expect(gate.shouldDiscard()).toBe(false);
    });

    it('suppresses reports once armed', () => {
        const gate = createQuotaGate(silentLogger, () => 0);
        gate.arm('quota');

        expect(gate.shouldDiscard()).toBe(true);
        expect(gate.shouldDiscard()).toBe(true);
    });

    it('suppresses a quota drop until the next UTC midnight', () => {
        // 2026-07-20T09:00:00Z — the pool refills at 2026-07-21T00:00:00Z.
        let now = Date.UTC(2026, 6, 20, 9, 0, 0);
        const gate = createQuotaGate(silentLogger, () => now);
        gate.arm('quota');

        now = Date.UTC(2026, 6, 20, 23, 59, 59);
        expect(gate.shouldDiscard()).toBe(true);

        now = Date.UTC(2026, 6, 21, 0, 0, 0);
        expect(gate.shouldDiscard()).toBe(false);
    });

    it('suppresses a lifecycle drop for half an hour, not until midnight', () => {
        let now = Date.UTC(2026, 6, 20, 9, 0, 0);
        const gate = createQuotaGate(silentLogger, () => now);
        gate.arm('paused');

        now += 29 * 60 * 1000;
        expect(gate.shouldDiscard()).toBe(true);

        now += 2 * 60 * 1000;
        expect(gate.shouldDiscard()).toBe(false);
    });

    it('lets one report through as a probe once the window passes', () => {
        let now = 0;
        const gate = createQuotaGate(silentLogger, () => now);
        gate.arm('archived');

        expect(gate.shouldDiscard()).toBe(true);

        now += 31 * 60 * 1000;
        // The probe goes out...
        expect(gate.shouldDiscard()).toBe(false);

        // ...and if nothing changed, the server's response re-arms the gate.
        gate.arm('archived');
        expect(gate.shouldDiscard()).toBe(true);
    });

    it('warns once per closure, not once per dropped report', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const logger = createLogger(true, []);
        const gate = createQuotaGate(logger, () => 0);

        // A burst of in-flight reports all landing on the same drop.
        gate.arm('quota');
        gate.arm('quota');
        gate.arm('quota');

        expect(warnSpy).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
    });

    it('lets a longer closure extend a shorter one', () => {
        let now = 0;
        const gate = createQuotaGate(silentLogger, () => now);

        gate.arm('paused'); // 30 minutes
        gate.arm('quota'); // until the next UTC midnight, which is further out

        now += 60 * 60 * 1000;
        expect(gate.shouldDiscard()).toBe(true);
    });
});

describe('transport with a quota gate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('stops sending after the server reports a drop', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(jsonResponse(200, { dropped: true, reason: 'quota' }));
        vi.stubGlobal('fetch', fetchMock);

        const { resolved } = resolveConfig({ apiKey: 'bb_pub_test' });
        const transport = createTransport(
            resolved,
            silentLogger,
            createQuotaGate(silentLogger, () => 0),
        );

        await transport.send(payload);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Every report after the drop is discarded before reaching the network.
        await transport.send(payload);
        await transport.send(payload);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps sending normally when reports are accepted', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);

        const { resolved } = resolveConfig({ apiKey: 'bb_pub_test' });
        const transport = createTransport(
            resolved,
            silentLogger,
            createQuotaGate(silentLogger, () => 0),
        );

        await transport.send(payload);
        await transport.send(payload);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not arm the gate on a deduplicated report', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { deduplicated: true }));
        vi.stubGlobal('fetch', fetchMock);

        const { resolved } = resolveConfig({ apiKey: 'bb_pub_test' });
        const transport = createTransport(
            resolved,
            silentLogger,
            createQuotaGate(silentLogger, () => 0),
        );

        await transport.send(payload);
        await transport.send(payload);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
