/**
 * Side-effect entry point: `import 'bugboard/preload'`.
 *
 * Node caches a module's source map only if support was already on when the
 * module was compiled, so enabling it inside `createClient()` comes too late
 * for everything the app imported on the way there. Importing this module first
 * — before any application code — covers the whole process.
 *
 * ```ts
 * // instrumentation.ts (Next.js), or the first import of your server entry
 * import 'bugboard/preload';
 * ```
 *
 * ```sh
 * node --import bugboard/preload ./server.js
 * ```
 *
 * Importing it in a browser or edge bundle does nothing and costs nothing.
 * `node --enable-source-maps` (or `NODE_OPTIONS=--enable-source-maps`) is an
 * equivalent alternative that needs no import at all.
 */

import { enableNodeSourceMaps } from './sourcemaps-node';

enableNodeSourceMaps();
