/**
 * esbuild plugin: `bugboard/esbuild`.
 *
 * ```js
 * import * as esbuild from 'esbuild';
 * import bugboard from 'bugboard/esbuild';
 *
 * await esbuild.build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   plugins: [bugboard()],
 * });
 * ```
 *
 * This is the one that matters for serverless and edge deployments — Lambda
 * bundles, Wrangler, SST, Serverless Framework and most zero-config deploy
 * tooling run esbuild underneath. Without it those builds report the bundle's
 * own coordinates, and unlike a Node server they often have no source maps
 * deployed to fall back on.
 *
 * esbuild has no transform pipeline, so unlike the Vite and webpack
 * integrations this reads the file itself in an `onLoad` callback and hands
 * esbuild the rewritten contents.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { transform as injectLocations, type TransformOptions } from './transform';

/** The subset of esbuild's plugin API this needs, declared to avoid a dependency. */
export interface EsbuildPlugin {
    name: string;
    setup(build: {
        initialOptions?: { absWorkingDir?: string };
        onLoad(
            filter: { filter: RegExp },
            callback: (args: { path: string }) => Promise<{
                contents: string;
                loader: string;
            } | null>,
        ): void;
    }): void;
}

export interface EsbuildPluginOptions extends TransformOptions {
    /** Files to rewrite. Defaults to JavaScript, TypeScript, and single-file components. */
    filter?: RegExp;
    /** Files to skip, applied after `filter`. Defaults to `node_modules`. */
    exclude?: RegExp;
    /** Log every file considered and what happened to it. */
    debug?: boolean;
}

const DEFAULT_FILTER = /\.([cm]?[jt]sx?|vue|svelte)$/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;

/** esbuild needs to be told how to parse whatever we hand back. */
const LOADERS: Record<string, string> = {
    '.js': 'js',
    '.mjs': 'js',
    '.cjs': 'js',
    '.jsx': 'jsx',
    '.ts': 'ts',
    '.mts': 'ts',
    '.cts': 'ts',
    '.tsx': 'tsx',
};

/**
 * Create the plugin.
 *
 * Returning `null` from `onLoad` hands the file back to esbuild untouched, so
 * anything this cannot improve — or cannot parse — costs nothing and breaks
 * nothing.
 */
export function bugboard(options: EsbuildPluginOptions = {}): EsbuildPlugin {
    const filter = options.filter ?? DEFAULT_FILTER;
    const exclude = options.exclude ?? DEFAULT_EXCLUDE;

    return {
        name: 'bugboard',

        setup(build) {
            const root = options.root ?? build.initialOptions?.absWorkingDir ?? process.cwd();

            build.onLoad({ filter }, async ({ path }) => {
                if (exclude.test(path)) return null;

                // Single-file components belong to their framework's own
                // plugin, which must run first; there is no loader to hand one
                // back under.
                const loader = LOADERS[extname(path)];
                if (!loader) return null;

                let code: string;
                try {
                    code = await readFile(path, 'utf8');
                } catch {
                    return null;
                }

                const result = injectLocations(code, path, { ...options, root });
                if (!result) {
                    if (options.debug) console.log(`[bugboard] no calls rewritten in ${path}`);
                    return null;
                }

                if (options.debug) {
                    console.log(`[bugboard] rewrote ${result.count} call(s) in ${path}`);
                }

                return { contents: result.code, loader };
            });
        },
    };
}

export default bugboard;
