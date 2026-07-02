import { describe, expect, it, vi } from 'vitest';

import { createClient } from '../src/client';
import type { ReportMethodName, ReportPayload } from '../src/types';
import { PRIORITY_SUFFIXES, SEVERITIES } from '../src/types';

function okResponse() {
    return new Response(JSON.stringify({ data: { id: 1 } }), { status: 201 });
}

/** Client wired to a mocked fetch; returns the bodies it sent. */
function clientWithMock(config: Parameters<typeof createClient>[0] = {}) {
    const bodies: ReportPayload[] = [];
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string) as ReportPayload);
        return Promise.resolve(okResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ apiKey: 'bb_pub_test', ...config });
    return { client, bodies, fetchMock };
}

describe('createClient', () => {
    it('exposes exactly the 16 reporting methods plus flush()', () => {
        const { client } = clientWithMock();

        const expected: string[] = [];
        for (const severity of SEVERITIES) {
            for (const suffix of Object.keys(PRIORITY_SUFFIXES)) {
                expected.push(`${severity}${suffix}`);
            }
        }

        expect(expected).toHaveLength(16);
        for (const name of expected) {
            expect(typeof client[name as ReportMethodName]).toBe('function');
        }
        expect(typeof client.flush).toBe('function');
    });

    it.each([
        ['critical', 'critical', 'medium'],
        ['criticalLow', 'critical', 'low'],
        ['criticalMedium', 'critical', 'medium'],
        ['criticalHigh', 'critical', 'high'],
        ['major', 'major', 'medium'],
        ['majorHigh', 'major', 'high'],
        ['moderateLow', 'moderate', 'low'],
        ['minor', 'minor', 'medium'],
        ['minorHigh', 'minor', 'high'],
    ] as const)('%s() reports severity=%s priority=%s', async (method, severity, priority) => {
        const { client, bodies } = clientWithMock();

        client[method]('Something happened');
        await client.flush();

        expect(bodies).toHaveLength(1);
        expect(bodies[0]).toMatchObject({ severity, priority, title: 'Something happened' });
    });

    it('passes description and tags through', async () => {
        const { client, bodies } = clientWithMock();

        client.major('Checkout is slow', 'p95 went from 2s to 9s', 'checkout,perf');
        await client.flush();

        expect(bodies[0]).toMatchObject({
            title: 'Checkout is slow',
            description: 'p95 went from 2s to 9s',
            tags: ['checkout', 'perf'],
        });
    });

    it('sends nothing when disabled', async () => {
        const { client, fetchMock } = clientWithMock({ enabled: false });

        client.critical('nope');
        await client.flush();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends nothing without credentials (and does not throw)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const client = createClient({});
        client.critical('nope');
        await client.flush();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('applies sampling', async () => {
        const { client, fetchMock } = clientWithMock({ sampleRate: 0.5 });
        const random = vi.spyOn(Math, 'random');

        random.mockReturnValue(0.9); // >= sampleRate → sampled out
        client.minor('dropped');
        random.mockReturnValue(0.1); // < sampleRate → sent
        client.minor('kept');
        await client.flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('lets beforeSend scrub the payload', async () => {
        const { client, bodies } = clientWithMock({
            beforeSend: (payload) => ({
                ...payload,
                description: payload.description?.replace(/user-\d+/g, '[user]'),
            }),
        });

        client.major('Login failed', 'user-42 could not log in');
        await client.flush();

        expect(bodies[0]!.description).toBe('[user] could not log in');
    });

    it('lets beforeSend drop a report', async () => {
        const { client, fetchMock } = clientWithMock({ beforeSend: () => null });

        client.major('vetoed');
        await client.flush();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never throws into the host app, even when everything is on fire', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => {
                throw new TypeError('network exploded');
            }),
        );

        const client = createClient({ apiKey: 'bb_pub_test', maxRetries: 0 });

        expect(() => client.critical('boom', new Error('cause'))).not.toThrow();
        await expect(client.flush()).resolves.toBeUndefined();
    });

    it('never throws when beforeSend itself is broken', async () => {
        const { client } = clientWithMock({
            beforeSend: () => {
                throw new Error('user bug');
            },
        });

        expect(() => client.minor('still safe')).not.toThrow();
        await client.flush();
    });
});
