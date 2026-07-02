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
});
