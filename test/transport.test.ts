import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../src/config';
import {
    BugBoardAuthError,
    BugBoardRateLimitError,
    BugBoardServerError,
    BugBoardValidationError,
} from '../src/errors';
import { createLogger } from '../src/logger';
import { createQuotaGate } from '../src/quota';
import { signedHeaders } from '../src/signer';
import { createTransport } from '../src/transport';
import type { ReportPayload } from '../src/types';

const payload: ReportPayload = {
    severity: 'major',
    priority: 'medium',
    title: 'SDK smoke test',
    tags: [],
};

const silentLogger = createLogger(false, []);

function transportWith(config: Parameters<typeof resolveConfig>[0] = {}) {
    const { resolved } = resolveConfig({ apiKey: 'bb_pub_test', ...config });
    return createTransport(resolved, silentLogger, createQuotaGate(silentLogger));
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/**
 * Run a send() to completion while fake timers fast-forward the backoff
 * sleeps. Handlers are attached immediately so a rejection during the timer
 * run is never flagged as unhandled.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
    let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
    const tracked = promise.then(
        (value) => {
            outcome = { ok: true, value };
        },
        (error: unknown) => {
            outcome = { ok: false, error };
        },
    );
    await vi.runAllTimersAsync();
    await tracked;
    if (!outcome) throw new Error('send() did not settle');
    if (outcome.ok) return outcome.value;
    throw outcome.error;
}

describe('transport', () => {
    it('POSTs JSON with bearer auth and succeeds on 201', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 1 } }));
        vi.stubGlobal('fetch', fetchMock);

        await settle(transportWith().send(payload));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://bugboard.dev/api/v1/tasks');
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify(payload));
        expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: 'Bearer bb_pub_test',
        });
    });

    it('POSTs to the api route under a custom base url, still signing /api/v1/tasks', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 1 } }));
        vi.stubGlobal('fetch', fetchMock);

        await settle(
            transportWith({
                apiKey: undefined,
                keyId: 'bbk_test',
                signingSecret: 'bb_sec_test',
                baseUrl: 'http://localhost:8000/',
            }).send(payload),
        );

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://localhost:8000/api/v1/tasks');

        // The base url must not leak into the signed path.
        const headers = init.headers as Record<string, string>;
        const expected = await signedHeaders(
            'bbk_test',
            'bb_sec_test',
            'POST',
            '/api/v1/tasks',
            JSON.stringify(payload),
            Number(headers['X-Bb-Timestamp']),
        );
        expect(headers['X-Bb-Signature']).toBe(expected['X-Bb-Signature']);
    });

    it('logs locally and never sends when logLocally is set (even with debug off)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        const { resolved } = resolveConfig({ apiKey: 'bb_pub_test', logLocally: true });
        // debug is false, so the logLocally channel must still emit.
        const logger = createLogger(false, []);
        await settle(createTransport(resolved, logger, createQuotaGate(logger)).send(payload));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledTimes(1);
        const logged = (logSpy.mock.calls[0] as unknown[]).join(' ');
        expect(logged).toContain('[bugboard]');
        expect(logged).toContain('Report (log-only, not sent):');
        expect(logged).toContain('SDK smoke test');

        logSpy.mockRestore();
    });

    it('signs with HMAC headers when a secret key is configured', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);

        await settle(
            transportWith({ apiKey: undefined, keyId: 'bbk_x', signingSecret: 'bb_sec_x' }).send(
                payload,
            ),
        );

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = init.headers as Record<string, string>;
        expect(headers['X-Bb-Key-Id']).toBe('bbk_x');
        expect(headers['X-Bb-Timestamp']).toMatch(/^\d+$/);
        expect(headers['X-Bb-Signature']).toMatch(/^[0-9a-f]{64}$/);
        expect(headers.Authorization).toBeUndefined();
    });

    it('asks the server to hide the response by default, and omits the header when opted out', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { deduplicated: false }));
        vi.stubGlobal('fetch', fetchMock);

        await settle(transportWith().send(payload));
        await settle(transportWith({ hideApiResponse: false }).send(payload));

        const headersOf = (call: number) =>
            (fetchMock.mock.calls[call] as [string, RequestInit])[1].headers as Record<
                string,
                string
            >;
        expect(headersOf(0)['X-Bb-Hide-Response']).toBe('true');
        expect(headersOf(1)['X-Bb-Hide-Response']).toBeUndefined();

        // The preference is a header, never a body field — it must not reach the payload.
        for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
            expect(init.body).toBe(JSON.stringify(payload));
        }
    });

    it('keeps the hide-response header outside the HMAC signature', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);

        await settle(
            transportWith({ apiKey: undefined, keyId: 'bbk_x', signingSecret: 'bb_sec_x' }).send(
                payload,
            ),
        );

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = init.headers as Record<string, string>;
        expect(headers['X-Bb-Hide-Response']).toBe('true');

        // The signature spans method + path + body only, so it is the same as it
        // would be with no hide-response header on the request at all.
        const expected = await signedHeaders(
            'bbk_x',
            'bb_sec_x',
            'POST',
            '/api/v1/tasks',
            JSON.stringify(payload),
            Number(headers['X-Bb-Timestamp']),
        );
        expect(headers['X-Bb-Signature']).toBe(expected['X-Bb-Signature']);
    });

    it('still reads the outcome flags when the server hides the card', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { quota_exceeded: true }));
        vi.stubGlobal('fetch', fetchMock);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { resolved } = resolveConfig({ apiKey: 'bb_pub_test' });
        const logger = createLogger(true, []);
        await settle(createTransport(resolved, logger, createQuotaGate(logger)).send(payload));

        // A hidden response carries no `data`, but the control flags survive (§5).
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect((warnSpy.mock.calls[0] as unknown[]).join(' ')).toContain('allowance is exhausted');

        warnSpy.mockRestore();
    });

    it('retries 5xx and eventually succeeds', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse(503, { message: 'down' }))
            .mockResolvedValueOnce(jsonResponse(502, { message: 'down' }))
            .mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);

        await settle(transportWith().send(payload));

        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries network errors', async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);

        await settle(transportWith().send(payload));

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('honors Retry-After on 429', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse(429, { message: 'slow down' }, { 'Retry-After': '7' }),
            )
            .mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        await settle(transportWith().send(payload));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        // The retry sleep must use the server's hint (7s), not the default backoff.
        expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 7000)).toBe(true);
    });

    it('gives up after maxRetries and surfaces a server error', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: 'kaput' }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(settle(transportWith({ maxRetries: 2 }).send(payload))).rejects.toBeInstanceOf(
            BugBoardServerError,
        );
        expect(fetchMock).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    });

    it.each([
        [401, BugBoardAuthError],
        [403, BugBoardAuthError],
        [422, BugBoardValidationError],
    ])('never retries a %i', async (status, errorClass) => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, { message: 'nope' }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(settle(transportWith().send(payload))).rejects.toBeInstanceOf(errorClass);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('carries the field errors on a 422', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                jsonResponse(422, { message: 'invalid', errors: { title: ['Too long.'] } }),
            );
        vi.stubGlobal('fetch', fetchMock);

        const error = await settle(transportWith().send(payload)).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BugBoardValidationError);
        expect((error as BugBoardValidationError).fieldErrors).toEqual({ title: ['Too long.'] });
    });

    it('carries retryAfter on a 429 that exhausts retries', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(jsonResponse(429, { message: 'limited' }, { 'Retry-After': '3' }));
        vi.stubGlobal('fetch', fetchMock);

        const error = await settle(transportWith({ maxRetries: 0 }).send(payload)).catch(
            (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(BugBoardRateLimitError);
        expect((error as BugBoardRateLimitError).retryAfter).toBe(3);
    });

    it('treats a quota drop (200 + quota_exceeded) as success and never retries it', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { quota_exceeded: true }));
        vi.stubGlobal('fetch', fetchMock);

        await settle(transportWith().send(payload));

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('aborts a hung request after timeoutMs and retries', async () => {
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(
                (_url, init: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () =>
                            reject(new DOMException('aborted', 'AbortError')),
                        );
                    }),
            )
            .mockResolvedValue(jsonResponse(201, {}));
        vi.stubGlobal('fetch', fetchMock);

        await settle(transportWith({ timeoutMs: 100 }).send(payload));

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('skips retries in keepalive (shutdown) mode', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: 'kaput' }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            settle(transportWith().send(payload, { keepalive: true })),
        ).rejects.toBeInstanceOf(BugBoardServerError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.keepalive).toBe(true);
    });
});
