/**
 * Request authentication.
 *
 * Publishable keys (`bb_pub_…`) are sent as a bearer token. Secret keys sign
 * each request with HMAC-SHA256 — the signing secret never travels on the
 * wire. The signing algorithm is ported verbatim from the API reference §3.2:
 *
 *     payload   = timestamp + "." + UPPERCASE(method) + "." + path + "." + sha256_hex(body)
 *     signature = hmac_sha256_hex(key = signingSecret, message = payload)
 *
 * WebCrypto (`globalThis.crypto.subtle`) is used so the same code runs on
 * Node 18+, browsers, and edge runtimes.
 */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function sha256Hex(data: string): Promise<string> {
    return toHex(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
    const key = await globalThis.crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    return toHex(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Bearer header for publishable keys. */
export function bearerHeaders(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}` };
}

/**
 * HMAC headers for secret keys. `body` must be the exact string transmitted —
 * re-serializing the JSON differently breaks the signature. Call once per
 * attempt: the server rejects timestamps older than ±300 s, so every retry
 * needs a fresh signature.
 */
export async function signedHeaders(
    keyId: string,
    signingSecret: string,
    method: string,
    path: string,
    body: string,
    timestamp: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
    const ts = String(timestamp);
    const bodyHash = await sha256Hex(body);
    const signature = await hmacSha256Hex(
        signingSecret,
        `${ts}.${method.toUpperCase()}.${path}.${bodyHash}`,
    );

    return {
        'X-Bb-Key-Id': keyId,
        'X-Bb-Timestamp': ts,
        'X-Bb-Signature': signature,
    };
}
