import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../src/config';

describe('resolveConfig', () => {
    it('applies the documented defaults', () => {
        const { resolved } = resolveConfig({ apiKey: 'bb_pub_x' });

        expect(resolved).toMatchObject({
            enabled: true,
            sampleRate: 1,
            maxQueueSize: 100,
            concurrency: 3,
            flushIntervalMs: 2000,
            timeoutMs: 5000,
            maxRetries: 3,
            debug: false,
            logLocally: false,
            hideApiResponse: true,
            endpoint: 'https://bugboard.dev/api/v1/tasks',
        });
    });

    it('honors hideApiResponse: false', () => {
        const { resolved } = resolveConfig({ apiKey: 'bb_pub_x', hideApiResponse: false });

        expect(resolved.hideApiResponse).toBe(false);
    });

    it('appends the api route to the base url, with or without a trailing slash', () => {
        for (const baseUrl of ['http://localhost:8000', 'http://localhost:8000/']) {
            const { resolved, warnings } = resolveConfig({ apiKey: 'bb_pub_x', baseUrl });
            expect(resolved.endpoint).toBe('http://localhost:8000/api/v1/tasks');
            expect(warnings).toEqual([]);
        }
    });

    it('keeps only the origin of the base url', () => {
        const { resolved } = resolveConfig({
            apiKey: 'bb_pub_x',
            baseUrl: 'https://example.com/bugboard?x=1',
        });
        expect(resolved.endpoint).toBe('https://example.com/api/v1/tasks');
    });

    it('falls back to BugBoard with a warning when the base url is not absolute', () => {
        for (const baseUrl of ['localhost:8000', 'not a url', '/api/v1/tasks']) {
            const { resolved, warnings } = resolveConfig({ apiKey: 'bb_pub_x', baseUrl });
            expect(resolved.endpoint).toBe('https://bugboard.dev/api/v1/tasks');
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('is not an absolute URL');
        }
    });

    it('picks bearer auth from a publishable key', () => {
        const { resolved } = resolveConfig({ apiKey: 'bb_pub_x' });
        expect(resolved.auth).toEqual({ scheme: 'bearer', apiKey: 'bb_pub_x' });
    });

    it('picks HMAC auth from a secret key pair', () => {
        const { resolved } = resolveConfig({ keyId: 'bbk_x', signingSecret: 'bb_sec_x' });
        expect(resolved.auth).toEqual({
            scheme: 'hmac',
            keyId: 'bbk_x',
            signingSecret: 'bb_sec_x',
        });
    });

    it('prefers the secret key when both are configured, with a warning', () => {
        const { resolved, warnings } = resolveConfig({
            apiKey: 'bb_pub_x',
            keyId: 'bbk_x',
            signingSecret: 'bb_sec_x',
        });

        expect(resolved.auth.scheme).toBe('hmac');
        expect(warnings.length).toBeGreaterThan(0);
    });

    it('disables the client instead of throwing when no credentials are set', () => {
        const { resolved, warnings } = resolveConfig({});

        expect(resolved.enabled).toBe(false);
        expect(warnings.some((w) => w.includes('disabled'))).toBe(true);
    });

    it('clamps sampleRate into [0, 1]', () => {
        expect(resolveConfig({ apiKey: 'k', sampleRate: 7 }).resolved.sampleRate).toBe(1);
        expect(resolveConfig({ apiKey: 'k', sampleRate: -1 }).resolved.sampleRate).toBe(0);
    });

    it('allows maxRetries of 0 but rejects garbage numeric options', () => {
        expect(resolveConfig({ apiKey: 'k', maxRetries: 0 }).resolved.maxRetries).toBe(0);
        expect(resolveConfig({ apiKey: 'k', maxQueueSize: -5 }).resolved.maxQueueSize).toBe(100);
        expect(resolveConfig({ apiKey: 'k', timeoutMs: NaN }).resolved.timeoutMs).toBe(5000);
    });

    it('honors enabled: false', () => {
        expect(resolveConfig({ apiKey: 'k', enabled: false }).resolved.enabled).toBe(false);
    });
});
