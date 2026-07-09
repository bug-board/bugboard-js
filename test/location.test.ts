import { describe, expect, it } from 'vitest';

import { captureLocation } from '../src/location';

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
});
