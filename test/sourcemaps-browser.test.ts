import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CapturedLocation } from '../src/location';
import { clearSourceMapCache, resolveViaSourceMap } from '../src/sourcemaps-browser';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const CHUNK = 'https://app.example.com/assets/index-a3f2b1.js';
const MAP = `${CHUNK}.map`;

/**
 * Encode one VLQ field. Written independently of the SDK's decoder so the two
 * have to agree on the format rather than on a shared bug.
 */
function encodeVlq(value: number): string {
    let rest = value < 0 ? (-value << 1) | 1 : value << 1;
    let out = '';

    do {
        let digit = rest & 31;
        rest >>>= 5;
        if (rest > 0) digit |= 32;
        out += BASE64[digit];
    } while (rest > 0);

    return out;
}

/** Encode `[genCol, srcIndex, srcLine, srcCol]` segments into a mappings string. */
function encodeMappings(lines: number[][][]): string {
    return lines
        .map((segments) => segments.map((fields) => fields.map(encodeVlq).join('')).join(','))
        .join(';');
}

/**
 * A map for a single-line minified chunk: the call at generated column 100
 * comes from `src/checkout/Payment.tsx` line 42 (0-based 41).
 */
function sampleMap(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: 3,
        file: 'index-a3f2b1.js',
        sources: ['src/entry.ts', 'src/checkout/Payment.tsx'],
        names: [],
        mappings: encodeMappings([
            [
                [0, 0, 0, 0],
                [100, 1, 41, 0],
            ],
        ]),
        ...overrides,
    });
}

/** Stub `fetch`, routing the chunk tail and the map to canned responses. */
function stubFetch(routes: Record<string, string | number>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((input: string) => {
        const body = routes[input];

        if (body === undefined) return Promise.resolve({ ok: false, status: 404 });
        if (typeof body === 'number') return Promise.resolve({ ok: false, status: body });

        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const at = (column: number, line = 1): CapturedLocation => ({
    file: '/assets/index-a3f2b1.js',
    line,
    raw: CHUNK,
    column,
});

afterEach(() => {
    clearSourceMapCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('resolveViaSourceMap', () => {
    it('resolves a minified position back to its original file and line', async () => {
        stubFetch({
            [CHUNK]: `console.log(1)\n//# sourceMappingURL=index-a3f2b1.js.map`,
            [MAP]: sampleMap(),
        });

        await expect(resolveViaSourceMap(at(105))).resolves.toEqual({
            file: 'src/checkout/Payment.tsx',
            line: 42,
        });
    });

    it('picks the segment at or before the column, not the nearest one', async () => {
        stubFetch({
            [CHUNK]: `//# sourceMappingURL=index-a3f2b1.js.map`,
            [MAP]: sampleMap(),
        });

        // Column 99 is still inside the first segment's span.
        await expect(resolveViaSourceMap(at(100))).resolves.toEqual({
            file: 'src/entry.ts',
            line: 1,
        });
    });

    it('falls back to <chunk>.map when there is no sourceMappingURL comment', async () => {
        stubFetch({ [CHUNK]: 'console.log(1)', [MAP]: sampleMap() });

        await expect(resolveViaSourceMap(at(105))).resolves.toEqual({
            file: 'src/checkout/Payment.tsx',
            line: 42,
        });
    });

    it('reads an inline data-URI map without a second request', async () => {
        const inline = Buffer.from(sampleMap()).toString('base64');
        const fetchMock = stubFetch({
            [CHUNK]: `//# sourceMappingURL=data:application/json;base64,${inline}`,
        });

        await expect(resolveViaSourceMap(at(105))).resolves.toEqual({
            file: 'src/checkout/Payment.tsx',
            line: 42,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('strips a webpack namespace from source paths', async () => {
        stubFetch({
            [CHUNK]: `//# sourceMappingURL=index-a3f2b1.js.map`,
            [MAP]: sampleMap({
                sources: ['webpack://my-app/./src/a.ts', 'webpack:///./src/b.tsx'],
            }),
        });

        await expect(resolveViaSourceMap(at(105))).resolves.toEqual({
            file: 'src/b.tsx',
            line: 42,
        });
    });

    it('applies sourceRoot', async () => {
        stubFetch({
            [CHUNK]: `//# sourceMappingURL=index-a3f2b1.js.map`,
            [MAP]: sampleMap({ sourceRoot: 'app/', sources: ['a.ts', 'b.tsx'] }),
        });

        await expect(resolveViaSourceMap(at(105))).resolves.toEqual({
            file: 'app/b.tsx',
            line: 42,
        });
    });

    it('probes a build that ships no maps exactly once', async () => {
        const fetchMock = stubFetch({ [CHUNK]: 'console.log(1)' });

        await expect(resolveViaSourceMap(at(105))).resolves.toBeUndefined();
        const afterFirst = fetchMock.mock.calls.length;

        await expect(resolveViaSourceMap(at(105))).resolves.toBeUndefined();
        expect(fetchMock.mock.calls.length).toBe(afterFirst);
    });

    it('shares one fetch across a burst of reports from the same chunk', async () => {
        const fetchMock = stubFetch({
            [CHUNK]: `//# sourceMappingURL=index-a3f2b1.js.map`,
            [MAP]: sampleMap(),
        });

        const results = await Promise.all([
            resolveViaSourceMap(at(105)),
            resolveViaSourceMap(at(105)),
            resolveViaSourceMap(at(105)),
        ]);

        expect(results.every((r) => r?.file === 'src/checkout/Payment.tsx')).toBe(true);
        // One tail request plus one map request, not three of each.
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up quietly on malformed JSON', async () => {
        stubFetch({ [CHUNK]: `//# sourceMappingURL=index-a3f2b1.js.map`, [MAP]: '{not json' });

        await expect(resolveViaSourceMap(at(105))).resolves.toBeUndefined();
    });

    it('gives up quietly when fetch rejects outright', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.reject(new Error('network down'))),
        );

        await expect(resolveViaSourceMap(at(105))).resolves.toBeUndefined();
    });

    it('does nothing without a column, which is the only thing to look up', async () => {
        const fetchMock = stubFetch({ [CHUNK]: 'x', [MAP]: sampleMap() });
        const noColumn: CapturedLocation = { file: '/a.js', line: 1, raw: CHUNK };

        await expect(resolveViaSourceMap(noColumn)).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ignores frames that are not http(s) URLs', async () => {
        const fetchMock = stubFetch({});
        const onDisk: CapturedLocation = {
            file: '/app/dist/index.js',
            line: 1,
            raw: '/app/dist/index.js',
            column: 10,
        };

        await expect(resolveViaSourceMap(onDisk)).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns undefined for a line the map does not cover', async () => {
        stubFetch({ [CHUNK]: `//# sourceMappingURL=index-a3f2b1.js.map`, [MAP]: sampleMap() });

        await expect(resolveViaSourceMap(at(105, 9))).resolves.toBeUndefined();
    });
});
