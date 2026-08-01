/**
 * Vite and Rollup plugin: `bugboard/vite`, `bugboard/rollup`.
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import bugboard from 'bugboard/vite';
 *
 * export default defineConfig({ plugins: [bugboard()] });
 * ```
 *
 * With this installed, cards report the file and line you wrote, not the chunk
 * they ended up in — in production builds, with no source maps generated,
 * deployed, or uploaded.
 */

import { identitySourceMap } from './sourcemap';
import { transform as injectLocations, type TransformOptions } from './transform';

/**
 * The shape Vite and Rollup expect. Declared structurally so the plugin needs
 * no dependency on either — and so `bugboard` stays installable in a project
 * that has neither.
 */
export interface BugBoardPlugin {
    name: string;
    enforce?: 'pre' | 'post';
    transform(
        this: unknown,
        code: string,
        id: string,
    ): { code: string; map: Record<string, unknown> } | null;
    configResolved?(config: { root?: string }): void;
}

export interface PluginOptions extends TransformOptions {
    /**
     * Files to rewrite. Defaults to JavaScript and TypeScript sources
     * (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`) plus single-file
     * components (`.vue`, `.svelte`), whose `<script>` blocks are rewritten.
     */
    include?: RegExp;
    /** Files to skip, applied after `include`. Defaults to `node_modules`. */
    exclude?: RegExp;
    /**
     * Log every file considered and what happened to it. Turn this on when
     * cards still name a chunk — it shows whether the plugin saw your module at
     * all, and if so whether it recognised the client.
     */
    debug?: boolean;
}

const DEFAULT_INCLUDE = /\.([cm]?[jt]sx?|vue|svelte)(\?|$)/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;

/**
 * A framework compiler's output for one part of a single-file component —
 * `App.vue?vue&type=script&setup=true&lang.ts`, and the Svelte equivalent.
 *
 * These must never be rewritten. The id still names the component, but the code
 * is compiler output whose lines no longer line up with the file anyone wrote,
 * so a location taken from it would be confidently wrong. The raw `.vue` or
 * `.svelte` file is handled instead, where the line numbers are real.
 */
const COMPILED_BLOCK = /[?&]type=(script|template|style)/;

/**
 * The directory to report paths relative to, when nobody has said.
 *
 * Plain Rollup has no equivalent of Vite's `configResolved`, so a plugin used
 * outside Vite — Nuxt runs one through Nitro's Rollup build, for instance —
 * never learns the project root and would otherwise report every server file by
 * its absolute path.
 */
function currentDirectory(): string | undefined {
    try {
        return typeof process === 'undefined' ? undefined : process.cwd();
    } catch {
        return undefined;
    }
}

/**
 * Create the plugin.
 *
 * Runs with `enforce: 'pre'`, before any other transform, so it reads the
 * source as written — original file, original line numbers. That includes
 * `.vue` and `.svelte` components, whose `<script>` blocks are rewritten in
 * place before the framework compiler turns them into something whose lines no
 * longer match the file on disk.
 */
export function bugboard(options: PluginOptions = {}): BugBoardPlugin {
    const include = options.include ?? DEFAULT_INCLUDE;
    const exclude = options.exclude ?? DEFAULT_EXCLUDE;
    let root = options.root;

    return {
        name: 'bugboard',
        enforce: 'pre',

        configResolved(config) {
            root ??= config.root;
        },

        transform(code, id) {
            // Virtual modules have no file behind them and are not the user's code.
            if (id.startsWith('\0')) return null;
            if (!include.test(id) || exclude.test(id) || COMPILED_BLOCK.test(id)) {
                if (options.debug) console.log(`[bugboard] skipped ${id}`);
                return null;
            }

            const result = injectLocations(code, id, {
                ...options,
                root: root ?? currentDirectory(),
            });
            if (!result) {
                if (options.debug) console.log(`[bugboard] no calls rewritten in ${id}`);
                return null;
            }

            if (options.debug) console.log(`[bugboard] rewrote ${result.count} call(s) in ${id}`);

            return { code: result.code, map: identitySourceMap(result.code, id) };
        },
    };
}

export default bugboard;
