import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    // The sealed-box binding ships with the SDK as a regular dependency but is
    // lazy-loaded via a runtime import() only when payload encryption is enabled.
    // Keep it external so the default path pulls in nothing at load time.
    external: ['tweetnacl-sealedbox-js'],
});
