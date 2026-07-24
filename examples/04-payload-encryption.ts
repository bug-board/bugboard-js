/**
 * Payload encryption (sealed box, X25519).
 * ════════════════════════════════════════
 *
 * Demonstrates: end-to-end encrypting report bodies so they're opaque on the wire.
 * Key type:     works with either auth mode; shown here with a publishable key.
 *
 * By default, report bodies are plaintext JSON over TLS — readable in the
 * browser's network tab and at any TLS-terminating proxy between you and
 * BugBoard. Set an encryption key and every payload is sealed with a libsodium
 * sealed box (X25519) BEFORE it leaves the client. Only BugBoard holds the
 * private key; the envelope is opaque everywhere on the wire.
 *
 * Nothing extra to install: the sealed-box binding ships with `bugboard` and is
 * dynamically imported the first time an encryption key is used — so if you
 * don't enable this, importing `bugboard` pulls it in nothing.
 *
 * Generate the keypair under Settings → API Keys → Payload encryption. The
 * public key is safe to embed in client code; the private key never leaves
 * BugBoard. The `encryptionKeyId` is echoed in the envelope so the server knows
 * which key to decrypt with — that's what makes rotation possible.
 */

import { createClient } from 'bugboard';

const bugboard = createClient({
  apiKey: import.meta.env.VITE_BUGBOARD_API_KEY,

  // Turn on encryption by setting both fields:
  encryptionPublicKey: import.meta.env.VITE_BUGBOARD_ENCRYPTION_PUBLIC_KEY, // base64 X25519
  encryptionKeyId: import.meta.env.VITE_BUGBOARD_ENCRYPTION_KEY_ID, // bbek_…

  environment: import.meta.env.MODE,
});

// From here on, reporting is identical — the encryption is transparent.
bugboard.criticalHigh('Payment capture failed', new Error('gateway timeout'), ['payments']);

export default bugboard;

/*
 * Server-side is the same — set the two encryption fields alongside your secret
 * key. Encryption happens BEFORE signing, so the HMAC covers the sealed bytes:
 *
 *   createClient({
 *     keyId: process.env.BUGBOARD_KEY_ID,
 *     signingSecret: process.env.BUGBOARD_SIGNING_SECRET,
 *     encryptionPublicKey: process.env.BUGBOARD_ENCRYPTION_PUBLIC_KEY,
 *     encryptionKeyId: process.env.BUGBOARD_ENCRYPTION_KEY_ID,
 *   });
 */
