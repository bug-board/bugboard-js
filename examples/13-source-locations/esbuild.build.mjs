// esbuild — and everything built on it: AWS Lambda bundles, Wrangler
// (Cloudflare Workers), SST, Serverless Framework.
//
// This matters more here than anywhere else: serverless bundles usually ship
// without source maps, so without the plugin there is nothing to fall back on.
import * as esbuild from 'esbuild';
import bugboard from 'bugboard/esbuild';

await esbuild.build({
    entryPoints: ['src/handler.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: 'dist/handler.mjs',
    plugins: [bugboard()],
});

// Cloudflare Workers: Wrangler runs esbuild but accepts no plugins, so bundle
// here first and point wrangler.toml at the output:
//
//   main = "dist/worker.mjs"
//
// For a Worker, build with platform: 'browser' and
// conditions: ['workerd', 'worker', 'browser'].
