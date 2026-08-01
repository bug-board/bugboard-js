import { describe, expect, it } from 'vitest';

import { captureLocation, locationFromError } from '../src/location';

/** Run `fn` with `new Error().stack` forced to `stack`. */
function withStack<T>(stack: string, fn: () => T): T {
    const RealError = globalThis.Error;
    class FakeError extends RealError {
        override stack = stack;
    }
    globalThis.Error = FakeError as unknown as ErrorConstructor;
    try {
        return fn();
    } finally {
        globalThis.Error = RealError;
    }
}

describe('captureLocation', () => {
    it('captures the file and line of its caller', () => {
        // The call below is on this line; capture should point back to this file.
        const location = captureLocation();

        expect(location).toBeDefined();
        expect(location!.file).toContain('location.test.ts');
        expect(location!.line).toBeGreaterThan(0);
    });

    it('reports different lines for calls on different lines', () => {
        const first = captureLocation();
        const second = captureLocation();

        expect(first).toBeDefined();
        expect(second).toBeDefined();
        expect(second!.line).toBe(first!.line + 1);
    });

    it('resolves the caller through an intermediate wrapper', () => {
        const wrapper = (): ReturnType<typeof captureLocation> => captureLocation();
        const location = wrapper();

        // The first frame outside this module is the wrapper's own call, which
        // is still in this test file — so we still get a real location here.
        expect(location).toBeDefined();
        expect(location!.file).toContain('location.test.ts');
    });

    it('strips the origin and dev-server query from a browser URL', () => {
        const location = withStack(
            [
                'Error',
                '    at captureLocation (http://localhost:5174/node_modules/bugboard/dist/index.js:12:15)',
                '    at App (http://localhost:5174/src/App.tsx?t=1783593985084:84:20)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/src/App.tsx', line: 84 });
    });

    it('keeps filesystem paths untouched', () => {
        const location = withStack(
            [
                'Error',
                '    at captureLocation (/app/node_modules/bugboard/dist/index.js:12:15)',
                '    at handler (/app/src/server.js:40:3)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/app/src/server.js', line: 40 });
    });

    it('does not merge same-path directories served from different origins', () => {
        // The SDK on a CDN and app code on the site share the path `/dist`, so
        // only the raw URL distinguishes the SDK frame from the caller's.
        const location = withStack(
            [
                'Error',
                '    at captureLocation (https://cdn.example.com/dist/bugboard.js:12:15)',
                '    at main (https://app.example.com/dist/main.js:7:1)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/dist/main.js', line: 7 });
    });

    it('keeps the untouched frame URL and column for source-map lookup', () => {
        // `file` is what gets reported; `raw` and `column` are what a source map
        // needs, and normalising them away would make resolution impossible.
        const location = withStack(
            [
                'Error',
                '    at captureLocation (https://app.example.com/assets/vendor-abc.js:1:915)',
                '    at App (https://app.example.com/assets/index-def.js?v=2:1:52341)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toEqual({
            file: '/assets/index-def.js',
            line: 1,
            raw: 'https://app.example.com/assets/index-def.js?v=2',
            column: 52341,
        });
    });

    it('falls back to a differing file when the whole build shares one directory', () => {
        // A Vite build puts the SDK and the app in sibling chunks under
        // `/assets`, so directory comparison cannot separate them.
        const location = withStack(
            [
                'Error',
                '    at n (https://app.example.com/assets/vendor-abc.js:1:915)',
                '    at r (https://app.example.com/assets/vendor-abc.js:1:1204)',
                '    at Checkout (https://app.example.com/assets/index-def.js:1:52341)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/assets/index-def.js', line: 1 });
    });

    it('falls back to frame depth when everything is inlined into one chunk', () => {
        // Nothing distinguishes the frames, but they all name the same file, so
        // the file is right regardless of which one is picked.
        const location = withStack(
            [
                'Error',
                '    at n (https://app.example.com/assets/index-abc.js:1:915)',
                '    at r (https://app.example.com/assets/index-abc.js:1:1204)',
                '    at Checkout (https://app.example.com/assets/index-abc.js:1:52341)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/assets/index-abc.js', line: 1 });
    });

    it('does not let the `async` keyword leak into the file name', () => {
        // V8 writes an awaited frame with no function name as
        // `at async <file>:<line>:<col>` — no parentheses to strip.
        const location = withStack(
            [
                'Error',
                '    at captureLocation (/app/dist/index.js:12:15)',
                '    at async /app/src/boot.js:14:1',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/app/src/boot.js', line: 14 });
    });

    it('skips Node internal frames, which sit below the real call site', () => {
        // A report made at module top level has the ESM loader beneath it. Its
        // directory differs from the SDK's, so a naive scan would return it.
        const location = withStack(
            [
                'Error',
                '    at captureLocation (/app/dist/chunk.js:1:915)',
                '    at report (/app/dist/chunk.js:1:1204)',
                '    at capture (/app/dist/chunk.js:1:2100)',
                '    at ModuleJob.run (node:internal/modules/esm/module_job:329:25)',
                '    at async ModuleLoader.import (node:internal/modules/esm/loader:264:20)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/app/dist/chunk.js' });
        expect(location!.file).not.toContain('node:');
    });

    it('still prefers a real caller over a Node frame appearing earlier', () => {
        const location = withStack(
            [
                'Error',
                '    at captureLocation (/app/node_modules/bugboard/dist/index.js:12:15)',
                '    at Timeout._onTimeout (node:internal/timers:581:17)',
                '    at handler (/app/src/server.js:40:3)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/app/src/server.js', line: 40 });
    });

    it('never attributes a report to a dependency that called your code', () => {
        // A framework invoking an event handler sits between the SDK and the
        // app. Its directory differs from the SDK's, so a naive scan picks it —
        // naming somebody else's package instead of the user's chunk.
        const location = withStack(
            [
                'Error',
                '    at captureLocation (/app/dist/vendor-abc.js:1:915)',
                '    at report (/app/dist/vendor-abc.js:1:1204)',
                '    at onClick (/app/dist/index-def.js:1:52341)',
                '    at callWithErrorHandling (/app/node_modules/@vue/runtime-core/dist/runtime-core.js:200:19)',
                '    at invoker (/app/node_modules/@vue/runtime-dom/dist/runtime-dom.js:88:5)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/app/dist/index-def.js' });
        expect(location!.file).not.toContain('node_modules');
    });

    it('prefers application code over a dependency even when the dependency comes first', () => {
        const location = withStack(
            [
                'Error',
                '    at captureLocation (/app/node_modules/bugboard/dist/index.js:12:15)',
                '    at forEach (/app/node_modules/lodash/lodash.js:530:11)',
                '    at handler (/app/src/server.js:40:3)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/app/src/server.js', line: 40 });
    });

    it('falls back to a dependency frame when there is genuinely nothing else', () => {
        // A report made from inside a library still deserves a location.
        const location = withStack(
            [
                'Error',
                '    at captureLocation (/app/node_modules/bugboard/dist/index.js:12:15)',
                '    at middleware (/app/node_modules/some-lib/index.js:7:1)',
            ].join('\n'),
            captureLocation,
        );

        expect(location).toMatchObject({ file: '/app/node_modules/some-lib/index.js', line: 7 });
    });

    it('returns undefined when the stack has no caller frame at all', () => {
        const location = withStack(
            ['Error', '    at captureLocation (/app/dist/index.js:12:15)'].join('\n'),
            captureLocation,
        );

        expect(location).toBeUndefined();
    });
});

/** An error-like object with a stack we control, in either stack dialect. */
function errorWithStack(message: string, frames: string[], cause?: unknown): Error {
    const error = new Error(message);
    error.stack = [`Error: ${message}`, ...frames].join('\n');
    if (cause !== undefined) error.cause = cause;
    return error;
}

describe('locationFromError', () => {
    it('reads the throw site off a real error', () => {
        const error = new Error('boom');

        const location = locationFromError(error);

        expect(location).toBeDefined();
        expect(location!.file).toContain('location.test.ts');
        expect(location!.line).toBeGreaterThan(0);
    });

    it('points at the throw site rather than wherever it is reported from', () => {
        const error = errorWithStack('card declined', [
            '    at charge (/app/src/charge.ts:17:9)',
            '    at store (/app/src/checkout.ts:42:5)',
        ]);

        // Reported from somewhere else entirely — as a global handler does.
        expect(locationFromError(error)).toMatchObject({ file: '/app/src/charge.ts', line: 17 });
    });

    it('keeps the raw frame and column so source maps can still resolve it', () => {
        const error = errorWithStack('boom', [
            '    at handler (http://localhost:5174/assets/index-a3f2b1.js?t=17835:1:8412)',
        ]);

        expect(locationFromError(error)).toMatchObject({
            file: '/assets/index-a3f2b1.js',
            raw: 'http://localhost:5174/assets/index-a3f2b1.js?t=17835',
            line: 1,
            column: 8412,
        });
    });

    it('unwraps to the root cause, whose stack is where things actually failed', () => {
        const root = errorWithStack('ECONNREFUSED', ['    at connect (/app/src/db.ts:9:3)']);
        const middle = errorWithStack(
            'query failed',
            ['    at query (/app/src/repo.ts:30:7)'],
            root,
        );
        const outer = errorWithStack(
            'Checkout failed',
            ['    at store (/app/src/api.ts:12:1)'],
            middle,
        );

        expect(locationFromError(outer)).toMatchObject({ file: '/app/src/db.ts', line: 9 });
    });

    it('falls back through the cause chain when the root cause has no usable stack', () => {
        const root = { message: 'not an error at all' };
        const outer = errorWithStack('wrapped', ['    at store (/app/src/api.ts:12:1)'], root);

        expect(locationFromError(outer)).toMatchObject({ file: '/app/src/api.ts', line: 12 });
    });

    it('survives a cyclic cause chain', () => {
        const outer = errorWithStack('outer', ['    at a (/app/src/a.ts:1:1)']);
        const inner = errorWithStack('inner', ['    at b (/app/src/b.ts:2:1)'], outer);
        outer.cause = inner;

        expect(locationFromError(outer)).toMatchObject({ file: '/app/src/b.ts', line: 2 });
    });

    it('is not fooled by a message that looks like a stack frame', () => {
        const error = new Error('parse failed at char:42');
        error.stack = [
            'Error: parse failed at char:42',
            '    at parse (/app/src/parser.ts:88:3)',
        ].join('\n');

        expect(locationFromError(error)).toMatchObject({ file: '/app/src/parser.ts', line: 88 });
    });

    it('reads a Firefox/Safari stack, which has no header line', () => {
        const error = new Error('boom');
        error.stack = ['charge@/app/src/charge.ts:17:9', 'store@/app/src/checkout.ts:42:5'].join(
            '\n',
        );

        expect(locationFromError(error)).toMatchObject({ file: '/app/src/charge.ts', line: 17 });
    });

    it('skips runtime-internal frames', () => {
        const error = errorWithStack('ENOENT', [
            '    at Object.readFileSync (node:fs:448:20)',
            '    at loadConfig (/app/src/config.ts:6:16)',
        ]);

        expect(locationFromError(error)).toMatchObject({ file: '/app/src/config.ts', line: 6 });
    });

    it('reports a dependency throw site as-is', () => {
        // Exact beats actionable: the runtime recorded this frame, and guessing
        // at "the first frame that looks like app code" blames innocent code.
        const error = errorWithStack('invalid selector', [
            '    at parse (/app/node_modules/some-lib/index.js:7:1)',
            '    at render (/app/src/App.tsx:20:4)',
        ]);

        expect(locationFromError(error)).toMatchObject({
            file: '/app/node_modules/some-lib/index.js',
            line: 7,
        });
    });

    it('reads a cross-realm error, which fails instanceof Error', () => {
        const error = {
            name: 'Error',
            message: 'boom',
            stack: 'Error: boom\n    at f (/a/b.js:3:1)',
        };

        expect(locationFromError(error)).toMatchObject({ file: '/a/b.js', line: 3 });
    });

    it('ignores a description that is not an error', () => {
        expect(locationFromError(undefined)).toBeUndefined();
        expect(locationFromError('an error, sort of')).toBeUndefined();
        expect(locationFromError({ file: '/x.ts', line: 1 })).toBeUndefined();
        expect(locationFromError({ stack: 'no frames in here' })).toBeUndefined();
    });
});
