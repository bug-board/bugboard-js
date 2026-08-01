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

    it('captures the caller file by default', async () => {
        const { client, bodies } = clientWithMock();

        client.criticalHigh('Payment error');
        await client.flush();

        expect(bodies[0]!.file_name).toContain('client.test.ts');
    });

    it('does not send a line number unless asked to', async () => {
        const { client, bodies } = clientWithMock();

        client.criticalHigh('Payment error');
        await client.flush();

        // The location is captured either way — the file proves it — but the
        // line is withheld, because outside a plugin build it is a guess.
        expect(bodies[0]!.file_name).toBeDefined();
        expect(bodies[0]!.line_number).toBeUndefined();
    });

    it('sends the line number once lineNumbers is switched on', async () => {
        const { client, bodies } = clientWithMock({ lineNumbers: true });

        client.criticalHigh('Payment error');
        await client.flush();

        expect(bodies[0]!.file_name).toContain('client.test.ts');
        expect(bodies[0]!.line_number).toBeGreaterThan(0);
    });

    it('captures the caller even from inside a catch or a callback', async () => {
        const { client, bodies } = clientWithMock({ lineNumbers: true });

        try {
            throw new Error('boom');
        } catch {
            client.critical('caught');
        }
        await new Promise<void>((resolve) => {
            setTimeout(() => {
                client.minor('later');
                resolve();
            }, 0);
        });
        await client.flush();

        expect(bodies).toHaveLength(2);
        for (const body of bodies) {
            expect(body.file_name).toContain('client.test.ts');
            expect(body.line_number).toBeGreaterThan(0);
        }
    });

    it('points a reported error at its throw site, not at the reporting call', async () => {
        const { client, bodies } = clientWithMock({ lineNumbers: true });
        const error = new Error('card declined');
        error.stack = [
            'Error: card declined',
            '    at charge (/src/checkout/charge.ts:17:9)',
            '    at store (/src/checkout/api.ts:42:5)',
        ].join('\n');

        // Reported from here — a global handler is exactly this shape.
        client.criticalHigh(error.message, error);
        await client.flush();

        expect(bodies[0]!.file_name).toBe('/src/checkout/charge.ts');
        expect(bodies[0]!.line_number).toBe(17);
    });

    it('falls back to the call site for a description that is not an error', async () => {
        const { client, bodies } = clientWithMock();

        client.criticalHigh('Payment error', { orderId: 42 });
        await client.flush();

        expect(bodies[0]!.file_name).toContain('client.test.ts');
    });

    it('omits the location for a reported error when captureLocation is false', async () => {
        const { client, bodies } = clientWithMock({ captureLocation: false });

        client.criticalHigh('Payment error', new Error('card declined'));
        await client.flush();

        expect(bodies[0]!.file_name).toBeUndefined();
        expect(bodies[0]!.line_number).toBeUndefined();
    });

    it('omits the call site when captureLocation is false', async () => {
        const { client, bodies } = clientWithMock({ captureLocation: false });

        client.criticalHigh('Payment error');
        await client.flush();

        expect(bodies[0]!.file_name).toBeUndefined();
        expect(bodies[0]!.line_number).toBeUndefined();
    });

    it('lets beforeSend strip the call site', async () => {
        const { client, bodies } = clientWithMock({
            beforeSend: ({ file_name: _f, line_number: _l, ...rest }) => rest,
        });

        client.criticalHigh('Payment error');
        await client.flush();

        expect(bodies[0]!.file_name).toBeUndefined();
        expect(bodies[0]!.line_number).toBeUndefined();
    });

    describe('a location injected by a build plugin', () => {
        /** Call as the build plugins rewrite it: location appended as the last argument. */
        const callAsPluginWould = (
            client: ReturnType<typeof createClient>,
            ...args: unknown[]
        ): void => (client.criticalHigh as (...a: unknown[]) => void)(...args);

        const location = { __bugboardLocation: true, file: 'src/checkout/Payment.tsx', line: 42 };

        it('is used instead of the captured stack', async () => {
            const { client, bodies } = clientWithMock();

            callAsPluginWould(client, 'Payment error', undefined, undefined, location);
            await client.flush();

            expect(bodies[0]!.file_name).toBe('src/checkout/Payment.tsx');
        });

        it('still withholds the line unless lineNumbers is on', async () => {
            // An injected line is exact, but the option governs the field: a
            // project either gets line numbers on its cards or it does not, and
            // that must not depend on which modules a plugin happened to reach.
            const plain = clientWithMock();
            callAsPluginWould(plain.client, 'Payment error', undefined, undefined, location);
            await plain.client.flush();

            expect(plain.bodies[0]!.line_number).toBeUndefined();

            const opted = clientWithMock({ lineNumbers: true });
            callAsPluginWould(opted.client, 'Payment error', undefined, undefined, location);
            await opted.client.flush();

            expect(opted.bodies[0]!.line_number).toBe(42);
        });

        it('is stripped from the arguments, leaving description and tags in place', async () => {
            const { client, bodies } = clientWithMock();

            // The plugin appends after however many arguments the caller wrote,
            // so `tags` here sits where a third argument normally would.
            callAsPluginWould(client, 'Payment error', 'card declined', ['payments'], location);
            await client.flush();

            expect(bodies[0]!.description).toContain('card declined');
            expect(bodies[0]!.tags).toContain('payments');
            expect(bodies[0]!.file_name).toBe('src/checkout/Payment.tsx');
        });

        it('is used even with fewer preceding arguments', async () => {
            const { client, bodies } = clientWithMock();

            callAsPluginWould(client, 'Payment error', location);
            await client.flush();

            expect(bodies[0]!.file_name).toBe('src/checkout/Payment.tsx');
            expect(bodies[0]!.description).toBeUndefined();
        });

        it('wins even when captureLocation is off', async () => {
            const { client, bodies } = clientWithMock({ captureLocation: false });

            callAsPluginWould(client, 'Payment error', undefined, undefined, location);
            await client.flush();

            expect(bodies[0]!.file_name).toBe('src/checkout/Payment.tsx');
        });

        it('falls back to stack capture when the brand is missing or malformed', async () => {
            const { client, bodies } = clientWithMock();

            // A stale plugin, or a user passing an object of their own.
            callAsPluginWould(client, 'Payment error', undefined, undefined, {
                file: 'spoofed.ts',
                line: 1,
            });
            await client.flush();

            expect(bodies[0]!.file_name).toContain('client.test.ts');
        });

        it('loses to a reported error, which knows where it was thrown', async () => {
            // The plugin's answer is exact — but it answers "where was this
            // reported", and the error answers "where did this fail". In a
            // global handler the first is the same file every time.
            const { client, bodies } = clientWithMock({ lineNumbers: true });
            const error = new Error('card declined');
            error.stack = 'Error: card declined\n    at charge (/src/charge.ts:17:9)';

            callAsPluginWould(client, 'Payment error', error, undefined, location);
            await client.flush();

            expect(bodies[0]!.file_name).toBe('/src/charge.ts');
            expect(bodies[0]!.line_number).toBe(17);
        });

        it('ignores a branded object with an unusable file or line', async () => {
            const { client, bodies } = clientWithMock();

            callAsPluginWould(client, 'Payment error', undefined, undefined, {
                __bugboardLocation: true,
                file: '',
                line: 0,
            });
            await client.flush();

            expect(bodies[0]!.file_name).toContain('client.test.ts');
        });
    });

    it('still delivers a report when the description fights back', async () => {
        // The backstop catches anything thrown while queueing, which means an
        // unguarded property read costs the entire card rather than one field.
        const { client, bodies } = clientWithMock();
        const hostile = new Error('hostile');
        for (const property of ['stack', 'message', 'name']) {
            Object.defineProperty(hostile, property, {
                get() {
                    throw new Error('nope');
                },
            });
        }

        client.criticalHigh('Payment error', hostile);
        await client.flush();

        expect(bodies).toHaveLength(1);
        expect(bodies[0]!.title).toBe('Payment error');
        expect(bodies[0]!.description).toBe('[Error]');
        // The location falls back to the call site, since the stack is unreadable.
        expect(bodies[0]!.file_name).toContain('client.test.ts');
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
