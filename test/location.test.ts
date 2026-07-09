import { describe, expect, it } from 'vitest';

import { captureLocation } from '../src/location';

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

        expect(location).toEqual({ file: '/src/App.tsx', line: 84 });
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

        expect(location).toEqual({ file: '/app/src/server.js', line: 40 });
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

        expect(location).toEqual({ file: '/dist/main.js', line: 7 });
    });
});
