import { defineConfig } from 'tsup';

export default defineConfig({
    entry: [
        'src/index.ts',
        // Side-effect entry: turns on Node's source-map support before the app
        // loads. Kept separate so importing the SDK proper stays inert.
        'src/preload.ts',
        // Build-time only. These run inside Vite/Rollup/webpack, never in the
        // app, so nothing here is reachable from the main entry.
        'src/plugin/vite.ts',
        'src/plugin/webpack.ts',
        'src/plugin/esbuild.ts',
    ],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: ['es2020', 'node20'],
    // tsup 8 rewrites `node:crypto` to bare `crypto` unless told not to. That
    // breaks every browser and edge bundle — the specifier no longer looks like
    // a builtin, so bundlers try to resolve it, and on npm `crypto` is somebody
    // else's package entirely. Keep the prefix.
    removeNodeProtocol: false,
    external: [
        // Ships with the SDK as a regular dependency but is lazy-loaded via a
        // runtime import() only when payload encryption is enabled. Keeping it
        // external means the default path pulls in nothing at load time.
        'tweetnacl-sealedbox-js',
        // Only reached on Node versions whose global `crypto` lacks `subtle`.
        // Left unresolved so a bundler decides what to do with it.
        'node:crypto',
    ],
});
