import { createHash, createHmac } from 'node:crypto';
import nacl from 'tweetnacl';
import sealedbox from 'tweetnacl-sealedbox-js';
import { describe, expect, it, vi } from 'vitest';

import { createClient } from '../src/client';
import { sealBody } from '../src/encryption';
import type { ReportPayload } from '../src/types';

interface Envelope {
    encrypted: { v: number; alg: string; key_id?: string; ciphertext: string };
}

function openEnvelope(body: string, keyPair: nacl.BoxKeyPair): ReportPayload {
    const envelope = JSON.parse(body) as Envelope;
    const sealed = new Uint8Array(Buffer.from(envelope.encrypted.ciphertext, 'base64'));
    const opened = sealedbox.open(sealed, keyPair.publicKey, keyPair.secretKey);
    if (!opened) throw new Error('sealed box failed to open');
    return JSON.parse(new TextDecoder().decode(opened)) as ReportPayload;
}

describe('sealBody', () => {
    it('produces the §11 envelope and a ciphertext only the private key can open', async () => {
        const keyPair = nacl.box.keyPair();
        const publicKeyB64 = Buffer.from(keyPair.publicKey).toString('base64');
        const plaintext = '{"severity":"major","title":"Encrypted smoke test"}';

        const body = await sealBody(plaintext, publicKeyB64, 'bbek_test');

        const envelope = JSON.parse(body) as Envelope;
        expect(envelope.encrypted.v).toBe(1);
        expect(envelope.encrypted.alg).toBe('x25519-sealedbox');
        expect(envelope.encrypted.key_id).toBe('bbek_test');
        expect(envelope.encrypted.ciphertext).not.toContain('Encrypted smoke test');

        const opened = openEnvelope(body, keyPair);
        expect(JSON.stringify(opened)).toBe(plaintext);
    });

    it('omits key_id when no encryption key id is configured', async () => {
        const keyPair = nacl.box.keyPair();
        const body = await sealBody('{}', Buffer.from(keyPair.publicKey).toString('base64'));

        const envelope = JSON.parse(body) as Envelope;
        expect('key_id' in envelope.encrypted).toBe(false);
    });
});

describe('client with encryption enabled', () => {
    it('transmits only the envelope, decryptable back to the original payload', async () => {
        const keyPair = nacl.box.keyPair();
        const sentBodies: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((_url: unknown, init: RequestInit) => {
                sentBodies.push(init.body as string);
                return Promise.resolve(new Response('{}', { status: 201 }));
            }),
        );

        const client = createClient({
            apiKey: 'bb_pub_test',
            encryptionPublicKey: Buffer.from(keyPair.publicKey).toString('base64'),
            encryptionKeyId: 'bbek_test',
        });

        client.criticalHigh('Payment failed', 'card ending 4242 declined', ['payments']);
        await client.flush();

        expect(sentBodies).toHaveLength(1);
        expect(sentBodies[0]).not.toContain('Payment failed'); // opaque on the wire

        const payload = openEnvelope(sentBodies[0]!, keyPair);
        expect(payload).toMatchObject({
            severity: 'critical',
            priority: 'high',
            title: 'Payment failed',
            description: 'card ending 4242 declined',
            tags: ['payments'],
        });
    });

    it('signs the envelope, not the plaintext (encrypt first, then sign)', async () => {
        const keyPair = nacl.box.keyPair();
        let sentBody = '';
        let headers: Record<string, string> = {};
        vi.stubGlobal(
            'fetch',
            vi.fn((_url: unknown, init: RequestInit) => {
                sentBody = init.body as string;
                headers = init.headers as Record<string, string>;
                return Promise.resolve(new Response('{}', { status: 201 }));
            }),
        );

        const client = createClient({
            keyId: 'bbk_test',
            signingSecret: 'bb_sec_test',
            encryptionPublicKey: Buffer.from(keyPair.publicKey).toString('base64'),
        });

        client.major('Signed and sealed');
        await client.flush();

        const bodyHash = createHash('sha256').update(sentBody).digest('hex');
        const expected = createHmac('sha256', 'bb_sec_test')
            .update(`${headers['X-Bb-Timestamp']}.POST./api/v1/tasks.${bodyHash}`)
            .digest('hex');

        expect(sentBody).toContain('"encrypted"');
        expect(headers['X-Bb-Signature']).toBe(expected);
    });
});
