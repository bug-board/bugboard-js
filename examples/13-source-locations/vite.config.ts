// Vite / Rollup — `bugboard/rollup` is the same plugin under a second name.
//
// Covers React, Vue and Svelte, and every Vite-based meta-framework: SvelteKit,
// Remix / React Router, Astro, Qwik. Add it alongside your framework plugin;
// order does not matter, since it runs with `enforce: 'pre'` regardless.
import { defineConfig } from 'vite';
import bugboard from 'bugboard/vite';

export default defineConfig({
    plugins: [
        // react(), svelte(), vue() — your framework plugin goes here
        bugboard({
            // Everything below is optional; the defaults suit most apps.

            // Extra modules that export a configured client. Not needed when the
            // module's path mentions "bugboard" (e.g. src/lib/bugboard.ts) or when
            // createClient() is called in the same file.
            clientModules: ['@/lib/telemetry'],

            // Log every file considered and what happened to it. Turn this on
            // first when cards still name a chunk.
            debug: false,

            // Widen matching to any receiver with a reporting method name, without
            // checking where it came from. Only if the rules above can't reach your
            // call sites — it can rewrite an unrelated call.
            loose: false,
        }),
    ],
});
