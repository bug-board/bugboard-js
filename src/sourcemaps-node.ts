/**
 * Node source-map support.
 *
 * A bundled server — Next's `.next/server/chunks`, a Nitro or esbuild bundle, a
 * zipped Lambda — reports stack frames in chunk coordinates: the file is
 * `chunks/456.js` and the line is wherever the minifier happened to put it.
 * The information needed to undo that is already on disk, in the `.js.map`
 * files the build wrote next to each chunk, and Node can read them itself.
 *
 * Switching that on costs one call and no uploads: the maps stay on the server,
 * never served publicly, and `Error.prototype.stack` starts naming original
 * files and lines — which the SDK's existing stack parsing then handles with no
 * changes at all.
 *
 * **The call must happen before the code you want mapped is loaded.** Node
 * caches a module's source map when it compiles the module, and only when
 * support is already on, so a module imported earlier keeps its chunk
 * coordinates forever. `createClient()` enables it, but by then the app's own
 * modules are usually loaded — import `bugboard/preload` first, or run Node
 * with `--enable-source-maps`, to cover everything.
 */

/**
 * The outcome of {@link enableNodeSourceMaps}.
 *
 * - `enabled` — this call turned support on.
 * - `already` — support was on before we got here (`--enable-source-maps`, a
 *   previous call, or a framework that does it for you). Nothing was changed.
 * - `unsupported` — not Node, or Node refused. Nothing was changed.
 */
export type SourceMapStatus = 'enabled' | 'already' | 'unsupported';

/**
 * `node:module`'s source-map controls, as reached through
 * `process.getBuiltinModule` rather than an import — a property access works
 * identically from ESM and CJS, and leaves nothing for a browser or edge
 * bundler to try to resolve.
 *
 * Declared locally because the shape has moved across Node releases and we call
 * it defensively either way; `setSourceMapsSupport` takes the flag positionally
 * (not as an options object) and is absent before Node 22.14.
 */
interface NodeModuleBuiltin {
    setSourceMapsSupport?: (
        enabled: boolean,
        options?: { nodeModules?: boolean; generatedCode?: boolean },
    ) => void;
}

interface NodeProcess {
    versions?: Record<string, string | undefined>;
    sourceMapsEnabled?: boolean;
    setSourceMapsEnabled?: (enabled: boolean) => void;
    getBuiltinModule?: (id: string) => unknown;
}

/** The host `process`, or `undefined` in a browser/edge runtime. */
function nodeProcess(): NodeProcess | undefined {
    // `process` is absent in browsers, whatever @types/node's global declaration says.
    const candidate = typeof process === 'undefined' ? undefined : (process as NodeProcess);
    if (!candidate?.versions?.node) return undefined;

    // Bun and Deno report a `node` version for compatibility but map stacks
    // themselves; there is nothing here for them to turn on.
    if (candidate.versions.bun || candidate.versions.deno) return undefined;

    return candidate;
}

/**
 * Turn on Node's source-map support, so stacks name original files and lines.
 *
 * Safe to call more than once, and safe to call from anywhere — a browser, an
 * edge runtime, or a Node version that has moved the API returns
 * `'unsupported'` rather than throwing. Reporting must never break the app it
 * monitors, so this never throws.
 */
export function enableNodeSourceMaps(): SourceMapStatus {
    try {
        const host = nodeProcess();
        if (!host) return 'unsupported';

        // Never re-enable: the user may have chosen a narrower scope than we
        // would, and `--enable-source-maps` is already the broadest.
        if (host.sourceMapsEnabled === true) return 'already';

        // Preferred (Node 22.14+): the same support, but without eagerly
        // reading a map for every dependency that ships one — dependency frames
        // are rarely what you are looking at, and a large `node_modules` makes
        // that real I/O on every cold start.
        const builtin = host.getBuiltinModule?.('node:module') as NodeModuleBuiltin | undefined;
        if (typeof builtin?.setSourceMapsSupport === 'function') {
            builtin.setSourceMapsSupport(true, { nodeModules: false, generatedCode: false });
            return 'enabled';
        }

        // Node 20/21: broader (it covers `node_modules` and `eval`ed code too),
        // but the same result for application frames.
        if (typeof host.setSourceMapsEnabled === 'function') {
            host.setSourceMapsEnabled(true);
            return 'enabled';
        }

        return 'unsupported';
    } catch {
        return 'unsupported';
    }
}

/** Whether this runtime is Node, and so a candidate for the above. */
export function isNodeRuntime(): boolean {
    return nodeProcess() !== undefined;
}
