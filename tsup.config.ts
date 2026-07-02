import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    // The sealed-box binding is an optional peer dependency, lazy-loaded only
    // when payload encryption is enabled — never bundle it.
    external: ['tweetnacl-sealedbox-js'],
});
