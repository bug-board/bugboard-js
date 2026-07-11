import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { bearerHeaders, signedHeaders } from '../src/signer';

/**
 * Reference vector generated with the openssl recipe from the API reference
 * §10 — the signer must produce these exact bytes for the same inputs.
 */
const VECTOR = {
    keyId: 'bbk_test123',
    secret: 'bb_sec_0123456789abcdef',
    timestamp: 1750000000,
    body: '{"severity":"major","title":"SDK smoke test"}',
    bodyHash: '9070dce6abd7e9819456eee1d61339f697b070b89e3e743a97ec66bf8754480e',
    signature: 'c9436e5c768e0cbea09119c0b112088f348f45aeb1c1ffcccecd62e65e2f3fc1',
};

describe('bearerHeaders', () => {
    it('sends the publishable key as a bearer token', () => {
        expect(bearerHeaders('bb_pub_abc')).toEqual({ Authorization: 'Bearer bb_pub_abc' });
    });
});

describe('signedHeaders', () => {
    it('matches the openssl reference vector', async () => {
        const headers = await signedHeaders(
            VECTOR.keyId,
            VECTOR.secret,
            'POST',
            '/api/v1/tasks',
            VECTOR.body,
            VECTOR.timestamp,
        );

        expect(headers).toEqual({
            'X-Bb-Key-Id': 'bbk_test123',
            'X-Bb-Timestamp': '1750000000',
            'X-Bb-Signature': VECTOR.signature,
        });
    });

    it('agrees with an independent node:crypto implementation for arbitrary input', async () => {
        const body = '{"severity":"minor","title":"ünïcode ✓"}';
        const timestamp = 1234567890;

        const headers = await signedHeaders(
            'bbk_x',
            'secret',
            'post',
            '/api/v1/tasks',
            body,
            timestamp,
        );

        const bodyHash = createHash('sha256').update(body).digest('hex');
        const expected = createHmac('sha256', 'secret')
            .update(`${timestamp}.POST./api/v1/tasks.${bodyHash}`)
            .digest('hex');

        expect(headers['X-Bb-Signature']).toBe(expected);
    });

    it('changes the signature when the body changes', async () => {
        const a = await signedHeaders('k', 's', 'POST', '/api/v1/tasks', '{"a":1}', 1);
        const b = await signedHeaders('k', 's', 'POST', '/api/v1/tasks', '{"a":2}', 1);
        expect(a['X-Bb-Signature']).not.toBe(b['X-Bb-Signature']);
    });

    it('uses the current unix time when no timestamp is given', async () => {
        const before = Math.floor(Date.now() / 1000);
        const headers = await signedHeaders('k', 's', 'POST', '/api/v1/tasks', '{}');
        const after = Math.floor(Date.now() / 1000);

        const ts = Number(headers['X-Bb-Timestamp']);
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
    });
});
