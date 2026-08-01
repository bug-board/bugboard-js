/**
 * webpack loader: `bugboard/webpack`.
 *
 * ```js
 * // webpack.config.js
 * module.exports = {
 *   module: {
 *     rules: [
 *       { test: /\.[cm]?[jt]sx?$/, exclude: /node_modules/, enforce: 'pre', use: 'bugboard/webpack' },
 *     ],
 *   },
 * };
 * ```
 *
 * Turbopack runs webpack loaders too, which is how this reaches Next 16 (where
 * Turbopack is the default and a bare `webpack` config is a build error). The
 * rules take no `as` field — Turbopack appends it to the filename, so
 * `as: '*.tsx'` sends it looking for `page.tsx.tsx`:
 *
 * ```js
 * // next.config.js
 * module.exports = {
 *   turbopack: {
 *     rules: {
 *       '*.ts': { loaders: ['bugboard/webpack'] },
 *       '*.tsx': { loaders: ['bugboard/webpack'] },
 *     },
 *   },
 * };
 * ```
 *
 * Shipped as a loader rather than a plugin so webpack resolves it by package
 * name, the same way it resolves any other loader — no path juggling between
 * the ESM and CommonJS builds. `enforce: 'pre'` matters: it puts this ahead of
 * Babel or SWC, so the source still has its original line numbers.
 */

import { identitySourceMap } from './sourcemap';
import { transform as injectLocations, type TransformOptions } from './transform';

/** The slice of webpack's loader context this needs. */
interface LoaderContext {
    resourcePath: string;
    rootContext?: string;
    getOptions?: () => TransformOptions | undefined;
    callback: (error: Error | null, code?: string, map?: Record<string, unknown> | string) => void;
}

/**
 * Rewrite one module's reporting calls.
 *
 * Never fails the build: if the module cannot be lexed, or anything else goes
 * wrong, the original source is passed through untouched. A missing location on
 * a card is a far better outcome than a build that will not run.
 */
export default function bugboardLoader(
    this: LoaderContext,
    code: string,
    map?: Record<string, unknown> | string,
): void {
    try {
        const options = this.getOptions?.() ?? {};
        const result = injectLocations(code, this.resourcePath, {
            root: this.rootContext,
            ...options,
        });

        if (!result) {
            this.callback(null, code, map);
            return;
        }

        // Only replace the incoming map when there wasn't one; chaining an
        // identity map onto an existing one would discard the real mappings.
        this.callback(null, result.code, map ?? identitySourceMap(result.code, this.resourcePath));
    } catch {
        this.callback(null, code, map);
    }
}
