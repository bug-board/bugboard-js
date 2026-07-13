/**
 * Call-site capture.
 *
 * Every reporting method wants to record *where in the user's code* it was
 * called — the file and line — the way `console.log` reports its own call site.
 * Whoever synchronously invokes a reporting method is on the JS stack at that
 * instant, so a fresh `Error().stack` taken inside the SDK contains the user's
 * frame. We parse that stack, skip the SDK's own frames, and return the first
 * caller frame.
 *
 * This works in every calling context (a `catch`, a React `useEffect`, a loop,
 * a promise/`setTimeout` callback, or a plain top-level call) because the
 * capture is synchronous with the call.
 */

/** A resolved source location: where a reporting call was made. */
export interface SourceLocation {
    file: string;
    line: number;
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
 * Capture the source location of the code that called into the SDK.
 *
 * Frame 0 of our own stack is this function; every other SDK frame (the report
 * closure, and — in an unbundled build — sibling modules) lives in the **same
 * directory** as it: `src/` in development, `dist/` (or `node_modules/…`) once
 * published and bundled. We skip that contiguous SDK prefix and return the
 * first frame from a different directory — the user's call site. Matching by
 * directory works whether the SDK ships as one bundled file or several.
 *
 * Returns `undefined` on any failure, or when no distinct caller frame can be
 * found (e.g. if a user inlines the SDK source into their own single bundle,
 * self and caller frames become indistinguishable — the same limitation other
 * capture-based tools have). Reporting must never throw, so this never does.
 */
export function captureLocation(): SourceLocation | undefined {
    try {
        const stack = new Error().stack;
        if (typeof stack !== 'string' || stack === '') return undefined;

        const frames: StackFrame[] = [];
        for (const raw of stack.split('\n')) {
            const frame = parseFrame(raw);
            if (frame) frames.push(frame);
        }

        // Frame 0 is captureLocation itself → its directory identifies SDK frames.
        // Compare raw files: two origins can share a directory path, and only the
        // raw form tells them apart.
        const self = frames[0];
        if (self === undefined) return undefined;
        const selfDir = dirOf(self.file);

        for (let i = 1; i < frames.length; i++) {
            const frame = frames[i]!;
            if (dirOf(frame.file) !== selfDir) {
                return { file: normalizeFile(frame.file), line: frame.line };
            }
        }

        return undefined;
    } catch {
        return undefined;
    }
}
