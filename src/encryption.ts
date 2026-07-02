/**
 * Optional payload encryption (API reference §11).
 *
 * When `encryptionPublicKey` is configured, every report body is sealed with
 * a libsodium-compatible sealed box (X25519 + XSalsa20-Poly1305) before it
 * leaves the client, so it is opaque in the browser network tab, at proxies,
 * and in access logs. BugBoard decrypts on receipt.
 *
 * The binding (`tweetnacl-sealedbox-js`, an optional peer dependency) is
 * lazy-loaded on first use — apps that never enable encryption load nothing.
 */

type Seal = (message: Uint8Array, publicKey: Uint8Array) => Uint8Array;

let sealPromise: Promise<Seal> | undefined;

async function loadSeal(): Promise<Seal> {
    sealPromise ??= import('tweetnacl-sealedbox-js').then(
        (mod: { seal?: Seal; default?: { seal?: Seal } }) => {
            const seal = mod.seal ?? mod.default?.seal;
            if (typeof seal !== 'function') {
                throw new Error('tweetnacl-sealedbox-js does not export seal()');
            }
            return seal;
        },
        (cause: unknown) => {
            sealPromise = undefined; // allow a later attempt if the app installs it
            throw new Error(
                'encryptionPublicKey is set but the optional peer dependency ' +
                    '"tweetnacl-sealedbox-js" could not be loaded. ' +
                    'Install it with: npm i tweetnacl-sealedbox-js',
                { cause },
            );
        },
    );
    return sealPromise;
}

function base64Decode(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function base64Encode(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/**
 * Seal a plaintext request body into the transport envelope (§11.3):
 *
 *     { "encrypted": { "v": 1, "alg": "x25519-sealedbox", "key_id"?, "ciphertext" } }
 *
 * Encryption changes the body, not the auth — HMAC signatures must be
 * computed over the envelope this returns (encrypt first, then sign).
 */
export async function sealBody(
    body: string,
    encryptionPublicKey: string,
    encryptionKeyId?: string,
): Promise<string> {
    const seal = await loadSeal();
    const publicKey = base64Decode(encryptionPublicKey);
    const sealed = seal(new TextEncoder().encode(body), publicKey);

    return JSON.stringify({
        encrypted: {
            v: 1,
            alg: 'x25519-sealedbox',
            ...(encryptionKeyId ? { key_id: encryptionKeyId } : {}),
            ciphertext: base64Encode(sealed),
        },
    });
}
