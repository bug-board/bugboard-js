/**
 * Where a report points.
 *
 * Every report wants to name *the code this is about* — a file and a line. Two
 * stacks can answer that, and the better one depends on what was reported:
 *
 * 1. **A reported error carries its own stack**, captured where it was thrown.
 *    That is the failure itself, and it stays right however far the error
 *    travelled — through awaits, across a promise chain, up to a handler — before
 *    anyone reported it.
 * 2. **Otherwise, the call site.** Whoever synchronously invokes a reporting
 *    method is on the JS stack at that instant, so a fresh `Error().stack` taken
 *    inside the SDK contains the user's frame. We parse that stack, skip the
 *    SDK's own frames, and return the first caller frame. This works in every
 *    calling context (a `catch`, a React `useEffect`, a loop, a
 *    promise/`setTimeout` callback, or a plain top-level call) because the
 *    capture is synchronous with the call.
 *
 * The order matters most where reporting is centralised. A global handler —
 * `window.onerror`, `process.on('uncaughtException')`, an Express error
 * middleware, a framework's error boundary — is user code, so rule 2 answers it
 * perfectly and uselessly: every error in the application reports the one file
 * the handler was defined in. Since `file_name` is a dedup identity server-side,
 * that also collapses unrelated bugs into a single card. Rule 1 exists so a
 * handler names the failure instead of itself.
 */

export type { SourceLocation } from './injected-location';

import type { SourceLocation } from './injected-location';

/**
 * A location read off the stack, with the details only stack capture can supply.
 *
 * `file`/`line` are what gets reported. `raw` and `column` are what a source
 * map needs to undo bundling: the untouched frame URL to fetch the map from,
 * and the column that identifies the call inside a minified line — where every
 * call in the whole chunk shares line 1.
 */
export interface CapturedLocation extends SourceLocation {
    raw: string;
    column?: number;
}

/**
 * A single parsed stack frame. `column` is captured for completeness even
 * though only file/line are sent to the server today.
 */
interface StackFrame {
    file: string;
    line: number;
    column?: number;
}

/**
 * Reduce a stack file to the path a developer would recognise.
 *
 * In a browser the stack names a module by its full URL, and dev servers
 * cache-bust it with a query string, so a Vite app reports
 * `http://localhost:5174/src/App.tsx?t=1783593985084` for what the developer
 * calls `/src/App.tsx`. Neither the origin (already implied by the report) nor
 * the query (different on every reload, which would split one file across many
 * identities server-side) carries information, so we drop both.
 *
 * Plain filesystem paths — Node's `/app/src/index.js`, Windows' `C:\app\x.js` —
 * have no `scheme://` and pass through untouched. `file:///a/b.js` loses only
 * its scheme and empty host, leaving `/a/b.js`.
 */
function normalizeFile(file: string): string {
    let normalized = file;

    const queryOrHash = normalized.search(/[?#]/);
    if (queryOrHash !== -1) normalized = normalized.slice(0, queryOrHash);

    const withoutOrigin = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/]*(\/.*)$/.exec(normalized);
    if (withoutOrigin?.[1] !== undefined) normalized = withoutOrigin[1];

    return normalized;
}

/**
 * Parse one stack line into a frame, or `undefined` if it isn't a frame.
 *
 * Two dialects cover every runtime we target:
 * - V8 (Node/Chrome/Edge): `    at fn (file:line:col)` and `    at file:line:col`
 * - SpiderMonkey/JavaScriptCore (Firefox/Safari): `fn@file:line:col` and `@file:line:col`
 *
 * The `file` part can itself contain colons (e.g. `https://` or a Windows
 * `C:\` path), so we anchor on the trailing `:line:col` and treat everything
 * before it as the file.
 */
function parseFrame(raw: string): StackFrame | undefined {
    const line = raw.trim();
    if (line === '') return undefined;

    // Strip the V8 "at " prefix and any surrounding parens around the location,
    // and the Firefox/Safari "fn@" prefix, leaving just "<file>:<line>:<col>".
    let location = line;

    const atMatch = /^at\s+(?:.*?\s+\()?(.*?)\)?$/.exec(location);
    if (atMatch?.[1] !== undefined) {
        location = atMatch[1];
    } else {
        const atIndex = location.lastIndexOf('@');
        if (atIndex !== -1) location = location.slice(atIndex + 1);
    }

    // An awaited frame with no function name reads `at async /app/x.js:4:1`, so
    // the keyword lands where the path should start. Named async frames keep
    // their location in parentheses and are already handled above.
    if (location.startsWith('async ')) location = location.slice('async '.length);

    // Trailing ":<line>" or ":<line>:<col>"; everything before is the file.
    const posMatch = /^(.*?):(\d+)(?::(\d+))?$/.exec(location);
    if (!posMatch) return undefined;

    const file = posMatch[1] ?? '';
    const lineNumber = Number(posMatch[2]);
    if (file === '' || !Number.isFinite(lineNumber)) return undefined;

    const frame: StackFrame = { file, line: lineNumber };
    if (posMatch[3] !== undefined) frame.column = Number(posMatch[3]);
    return frame;
}

/** The directory portion of a stack file (path or URL); the file itself if none. */
function dirOf(file: string): string {
    const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
    return slash === -1 ? file : file.slice(0, slash);
}

/**
 * Whether a frame belongs to the runtime rather than to anyone's code.
 *
 * Node's module loader, timers, and async hooks appear in stacks as
 * `node:internal/…`, and they sit *below* the user's frames — so a report made
 * at module top level has `node:internal/modules/esm/module_job` as the first
 * frame outside the SDK's own directory. It is never the call site anyone
 * wants, and matching it would beat the real answer to the punch.
 */
function isRuntimeInternal(file: string): boolean {
    return file.startsWith('node:');
}

/**
 * How far to follow `cause` looking for the original failure. A wrapping chain
 * is a handful of links deep in practice; the cap is a guard against a cycle
 * (`cause` is a plain property, so nothing stops one) so reporting cannot hang.
 */
const MAX_CAUSE_DEPTH = 10;

/**
 * Anything carrying a stack string. Deliberately not `instanceof Error`: an
 * error thrown in an iframe, a `vm` context, or a worker belongs to a different
 * realm and fails that check while being exactly what we want. A non-error that
 * happens to have a `stack` string costs one failed parse and falls through.
 */
interface ErrorLike {
    name?: unknown;
    message?: unknown;
    stack: string;
    cause?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { stack?: unknown }).stack === 'string'
    );
}

/** The error and its `cause` chain, outermost first, bounded and cycle-safe. */
function causeChain(error: ErrorLike): ErrorLike[] {
    const chain = [error];
    const seen = new Set<unknown>([error]);

    let current: unknown = error.cause;
    while (isErrorLike(current) && !seen.has(current) && chain.length < MAX_CAUSE_DEPTH) {
        seen.add(current);
        chain.push(current);
        current = current.cause;
    }

    return chain;
}

/**
 * The frame lines of a stack, without the `Name: message` header V8 writes
 * above them (SpiderMonkey and JavaScriptCore write no header at all).
 *
 * Stripped by exact prefix rather than skipped by shape, because a message is
 * arbitrary user text: `new Error('parse failed at char:42')` has a header line
 * that parses as a frame in `file:line` form and would otherwise win, naming a
 * file that does not exist.
 */
function stackBody(error: ErrorLike): string {
    const name = typeof error.name === 'string' ? error.name : '';
    const message = typeof error.message === 'string' ? error.message : '';

    for (const header of [`${name}: ${message}`, name, message]) {
        if (header !== '' && error.stack.startsWith(header))
            return error.stack.slice(header.length);
    }

    return error.stack;
}

/**
 * The throw site of a reported error, or `undefined` if this is not one.
 *
 * The **root cause** is consulted first: an error that wraps another was
 * constructed where the failure was caught, so its own top frame names the
 * catcher. `new Error('Checkout failed', { cause: err })` should point at
 * whatever `err` hit, and the innermost `cause` is that.
 *
 * The top frame is reported as-is even when it lands in `node_modules`. It is
 * exact — the runtime recorded it — where "the first frame that looks like app
 * code" is a guess, and a wrong guess here points at innocent code with an
 * authority it has not earned. (Frames belonging to the runtime itself are
 * skipped: `node:internal/…` is not a file anyone can open.)
 *
 * The result carries `raw` and `column` like a captured location, so a bundled
 * frame goes through source-map resolution the same way.
 *
 * Never throws; reporting must not fail because a stack was unreadable.
 */
export function locationFromError(value: unknown): CapturedLocation | undefined {
    try {
        if (!isErrorLike(value)) return undefined;

        for (const error of causeChain(value).reverse()) {
            for (const raw of stackBody(error).split('\n')) {
                const frame = parseFrame(raw);
                if (!frame || isRuntimeInternal(frame.file)) continue;

                const location: CapturedLocation = {
                    file: normalizeFile(frame.file),
                    line: frame.line,
                    raw: frame.file,
                };
                if (frame.column !== undefined) location.column = frame.column;

                return location;
            }
        }

        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Whether a frame belongs to a dependency rather than to the application.
 *
 * Libraries call your code: a framework invokes an event handler, a router
 * invokes a route, a test runner invokes a test. Those frames sit between the
 * SDK and the code a developer would recognise, and they live in a different
 * directory — which is exactly what the caller scan looks for. Left alone, a
 * report made from a Vue template handler names `@vue/runtime-core`, which is
 * both wrong and unactionable.
 *
 * The SDK's own frames are usually in `node_modules` too, but those are
 * identified separately, by frame 0, so filtering here is safe.
 */
function isDependency(file: string): boolean {
    return /[\\/]node_modules[\\/]/.test(file);
}

/**
 * How many frames the SDK itself contributes above the caller: this function
 * and the `report` closure in `client.ts`. Only consulted by the last-resort
 * pass below, where every frame shares one file and the count is the only
 * signal left.
 */
const SDK_FRAME_DEPTH = 2;

/**
 * Capture the source location of the code that called into the SDK.
 *
 * Frame 0 of our own stack is this function; the caller is somewhere below it,
 * past the SDK's own frames. How to tell those apart depends entirely on how
 * the SDK was built, so we try three rules in order of confidence:
 *
 * 1. **Different directory.** The SDK's frames live together — `src/` in
 *    development, `dist/` or `node_modules/…` once published — so the first
 *    frame from another directory is the caller. Correct whether the SDK ships
 *    as one file or several, and it distinguishes a CDN-hosted SDK from app
 *    code at the same path, because the comparison keeps the raw origin.
 * 2. **Different file.** A bundler puts the SDK and the app in sibling chunks
 *    under one directory (`/assets/vendor-abc.js` vs `/assets/index-def.js`),
 *    which rule 1 cannot separate. The coordinates are the chunk's, not the
 *    original source's — install the build plugin (`bugboard/vite`) to get
 *    real ones.
 * 3. **Frame depth.** Everything landed in a single chunk, so no frame differs
 *    from any other. Every frame names the same file, so the file is right no
 *    matter which we pick; only the line is a guess, and in a minified bundle
 *    even that is the same line for all of them.
 *
 * All three run over the application's frames first, with dependencies held
 * back. A library that calls your code — a framework invoking an event handler,
 * a router invoking a route — sits between the SDK and anything a developer
 * would recognise, and it satisfies rule 1 perfectly while naming the wrong
 * project entirely. Dependencies are only considered if there is nothing else.
 *
 * Returns `undefined` on any failure or an unreadable stack. Reporting must
 * never throw, so this never does.
 */
export function captureLocation(): CapturedLocation | undefined {
    try {
        const stack = new Error().stack;
        if (typeof stack !== 'string' || stack === '') return undefined;

        const frames: StackFrame[] = [];
        for (const raw of stack.split('\n')) {
            const frame = parseFrame(raw);
            if (frame && !isRuntimeInternal(frame.file)) frames.push(frame);
        }

        // Frame 0 is captureLocation itself → it identifies the SDK's own code.
        // Compare raw files: two origins can share a directory path, and only
        // the raw form tells them apart.
        const self = frames[0];
        if (self === undefined) return undefined;
        const selfDir = dirOf(self.file);

        const pick = (candidates: StackFrame[]): StackFrame | undefined =>
            candidates.find((frame) => dirOf(frame.file) !== selfDir) ??
            candidates.find((frame) => frame.file !== self.file);

        const below = frames.slice(1);
        const application = below.filter((frame) => !isDependency(frame.file));

        // Depth is measured within a candidate list, which already excludes
        // frame 0; the SDK contributes one more frame below it.
        const byDepth = (candidates: StackFrame[]): StackFrame | undefined =>
            candidates[SDK_FRAME_DEPTH - 1];

        // Application frames are exhausted — including the depth guess — before
        // a dependency is ever considered. A single-chunk build leaves the SDK
        // and the caller indistinguishable by file *and* directory, and falling
        // through to a dependency there would name whichever library happened to
        // invoke the callback rather than the app it was bundled with.
        const caller = pick(application) ?? byDepth(application) ?? pick(below) ?? byDepth(below);

        if (caller === undefined) return undefined;

        const location: CapturedLocation = {
            file: normalizeFile(caller.file),
            line: caller.line,
            raw: caller.file,
        };
        if (caller.column !== undefined) location.column = caller.column;

        return location;
    } catch {
        return undefined;
    }
}
