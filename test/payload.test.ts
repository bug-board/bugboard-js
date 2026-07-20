import { describe, expect, it } from 'vitest';

import { buildPayload, normalizeTags } from '../src/payload';

const noContext = { environment: undefined, release: undefined, defaultTags: [] };

describe('normalizeTags', () => {
    it('accepts an array', () => {
        expect(normalizeTags(['ui', 'android'])).toEqual(['ui', 'android']);
    });

    it('accepts a CSV string', () => {
        expect(normalizeTags('ui, android')).toEqual(['ui', 'android']);
    });

    it('trims, drops empties, and de-dupes', () => {
        expect(normalizeTags([' ui ', '', 'ui', '  '])).toEqual(['ui']);
        expect(normalizeTags('a,,b, a ,b')).toEqual(['a', 'b']);
    });

    it('clamps each tag to 50 characters', () => {
        const [tag] = normalizeTags(['x'.repeat(80)]);
        expect(tag).toHaveLength(50);
    });

    it('returns an empty array when tags are omitted', () => {
        expect(normalizeTags(undefined)).toEqual([]);
    });
});

describe('buildPayload', () => {
    it('sets severity and priority from the method, and clamps the title to 255 chars', () => {
        const payload = buildPayload(
            'critical',
            'high',
            'T'.repeat(300),
            undefined,
            undefined,
            noContext,
        );

        expect(payload.severity).toBe('critical');
        expect(payload.priority).toBe('high');
        expect(payload.title).toHaveLength(255);
        expect(payload.description).toBeUndefined();
        expect(payload.tags).toEqual([]);
    });

    it('passes string descriptions through', () => {
        const payload = buildPayload(
            'minor',
            'low',
            'Title',
            'something broke',
            undefined,
            noContext,
        );
        expect(payload.description).toBe('something broke');
    });

    it('extracts message and stack from an Error', () => {
        const error = new Error('boom');
        const payload = buildPayload('major', 'medium', 'Title', error, undefined, noContext);

        expect(payload.description).toContain('boom');
        expect(payload.description).toContain('payload.test.ts');
        // The V8 stack already contains "Error: boom" — the message must not be duplicated.
        expect(payload.description?.indexOf('boom')).toBe(payload.description?.lastIndexOf('boom'));
    });

    it('pretty-prints objects and arrays with a two-space indent', () => {
        const payload = buildPayload(
            'minor',
            'low',
            'T',
            { a: 1, b: [1, 2] },
            undefined,
            noContext,
        );

        expect(payload.description).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    });

    it.each([
        [true, 'true'],
        [false, 'false'],
        [0, '0'],
        [1.0, '1'],
        [0.1 + 0.2, '0.30000000000000004'],
        [1e25, '1e+25'],
        [1e-7, '1e-7'],
        [NaN, 'NaN'],
        [Infinity, 'Infinity'],
        [-Infinity, '-Infinity'],
    ])('stringifies the scalar %p as %p', (input, expected) => {
        const payload = buildPayload('minor', 'low', 'T', input, undefined, noContext);

        expect(payload.description).toBe(expected);
    });

    it('omits an empty-string description but keeps a false one', () => {
        // String(false) is "false", not "" — a false description must survive.
        expect(
            buildPayload('minor', 'low', 'T', '', undefined, noContext).description,
        ).toBeUndefined();
        expect(buildPayload('minor', 'low', 'T', false, undefined, noContext).description).toBe(
            'false',
        );
    });

    it('replaces a cycle without discarding the rest of the object', () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;

        const { description } = buildPayload('minor', 'low', 'T', cyclic, undefined, noContext);

        expect(description).toContain('"a": 1');
        expect(description).toContain('[Circular]');
    });

    it('keeps repeated but acyclic references intact', () => {
        const shared = { x: 1 };

        const { description } = buildPayload(
            'minor',
            'low',
            'T',
            { p: shared, q: shared },
            undefined,
            noContext,
        );

        expect(description).not.toContain('[Circular]');
    });

    it('extracts an Error nested in a context object instead of rendering it as {}', () => {
        const { description } = buildPayload(
            'minor',
            'low',
            'T',
            { ctx: 'checkout', err: new Error('nested boom') },
            undefined,
            noContext,
        );

        expect(description).toContain('nested boom');
        expect(description).toContain('"ctx": "checkout"');
    });

    it('survives bigints, functions, Maps, and Sets', () => {
        const { description } = buildPayload(
            'minor',
            'low',
            'T',
            { n: 10n, fn: function named() {}, m: new Map([['a', 1]]), s: new Set([1, 2]) },
            undefined,
            noContext,
        );

        expect(description).toContain('"10n"');
        expect(description).toContain('[Function named]');
        expect(description).toContain('"a": 1');
        expect(description).toContain('"s": [\n    1,\n    2\n  ]');
    });

    it('marks a truncated description and stays exactly within the cap', () => {
        const { description } = buildPayload(
            'minor',
            'low',
            'T',
            { blob: 'x'.repeat(70_000) },
            undefined,
            noContext,
        );

        expect(description!.length).toBe(60_000);
        expect(description!.endsWith('\n… truncated')).toBe(true);
    });

    it('truncates oversized descriptions below the server cap', () => {
        const payload = buildPayload(
            'minor',
            'low',
            'Title',
            'x'.repeat(70_000),
            undefined,
            noContext,
        );
        expect(payload.description!.length).toBeLessThanOrEqual(60_000);
    });

    it('folds environment, release, and defaultTags into the tags', () => {
        const payload = buildPayload('moderate', 'medium', 'Title', undefined, ['ui'], {
            environment: 'production',
            release: '1.4.2',
            defaultTags: ['web'],
        });

        expect(payload.tags).toEqual(['web', 'env:production', 'release:1.4.2', 'ui']);
    });

    it('de-dupes call tags against default tags', () => {
        const payload = buildPayload('moderate', 'medium', 'Title', undefined, 'web,ui', {
            ...noContext,
            defaultTags: ['web'],
        });

        expect(payload.tags).toEqual(['web', 'ui']);
    });

    it('attaches file_name and line_number when a location is given', () => {
        const payload = buildPayload('minor', 'low', 'Title', undefined, undefined, noContext, {
            file: 'src/pages/Checkout.tsx',
            line: 42,
        });

        expect(payload.file_name).toBe('src/pages/Checkout.tsx');
        expect(payload.line_number).toBe(42);
    });

    it('omits file_name and line_number when no location is given', () => {
        const payload = buildPayload('minor', 'low', 'Title', undefined, undefined, noContext);

        expect(payload.file_name).toBeUndefined();
        expect(payload.line_number).toBeUndefined();
    });
});
