import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { enableNodeSourceMaps, isNodeRuntime } from '../src/sourcemaps-node';

const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/**
 * A module whose stack frames only resolve to `ORIGINAL_<name>.ts` if source
 * map support is on — the on-disk equivalent of a built chunk plus its map.
 */
function writeMappedModule(dir: string, name: string): string {
    const file = join(dir, `${name}.js`);

    writeFileSync(
        file,
        `export function boom(){ throw new Error('x'); }\n//# sourceMappingURL=${name}.js.map\n`,
    );
    writeFileSync(
        `${file}.map`,
        JSON.stringify({
            version: 3,
            file: `${name}.js`,
            sources: [`ORIGINAL_${name}.ts`],
            names: [],
            mappings: 'AAAA',
        }),
    );

    return file;
}

describe('enableNodeSourceMaps', () => {
    it('reports a usable status on Node and is safe to repeat', () => {
        expect(isNodeRuntime()).toBe(true);

        const first = enableNodeSourceMaps();
        expect(first).not.toBe('unsupported');

        // Whatever the first call did, the second must find it already on and
        // change nothing.
        expect(enableNodeSourceMaps()).toBe('already');
    });

    it('makes stacks name original files, but only for modules loaded after it', () => {
        // Run in a child process: vitest configures source maps for its own
        // stack traces, so the enable/disable boundary is only observable in a
        // process this test controls from the start.
        const dir = mkdtempSync(join(tmpdir(), 'bugboard-sourcemaps-'));
        workspaces.push(dir);

        const before = writeMappedModule(dir, 'before');
        const after = writeMappedModule(dir, 'after');
        const sdk = join(import.meta.dirname, '..', 'src', 'sourcemaps-node.ts');

        const probe = join(dir, 'probe.mjs');
        writeFileSync(
            probe,
            `
            const frame = (fn) => { try { fn(); } catch (e) { return e.stack.split('\\n')[1].trim(); } };
            const early = await import(${JSON.stringify(`file://${before}`)});
            const earlyFrame = frame(early.boom);

            const { enableNodeSourceMaps } = await import(${JSON.stringify(`file://${sdk}`)});
            const status = enableNodeSourceMaps();

            const late = await import(${JSON.stringify(`file://${after}`)});
            console.log(JSON.stringify({ status, earlyFrame, lateFrame: frame(late.boom) }));
            `,
        );

        const output = execFileSync(
            process.execPath,
            ['--experimental-strip-types', '--no-warnings', probe],
            { encoding: 'utf8' },
        );
        const result = JSON.parse(output.trim()) as {
            status: string;
            earlyFrame: string;
            lateFrame: string;
        };

        expect(result.status).toBe('enabled');
        // Loaded before the call: still the built file.
        expect(result.earlyFrame).toContain('before.js');
        expect(result.earlyFrame).not.toContain('ORIGINAL_before.ts');
        // Loaded after: resolved through the map sitting next to it on disk.
        expect(result.lateFrame).toContain('ORIGINAL_after.ts');
    });

    it('reports "already" without changing anything when the flag is set', () => {
        const sdk = join(import.meta.dirname, '..', 'src', 'sourcemaps-node.ts');
        const output = execFileSync(
            process.execPath,
            [
                '--enable-source-maps',
                '--experimental-strip-types',
                '--no-warnings',
                '--input-type=module',
                '-e',
                `const { enableNodeSourceMaps } = await import(${JSON.stringify(`file://${sdk}`)});
                 console.log(enableNodeSourceMaps());`,
            ],
            { encoding: 'utf8' },
        );

        expect(output.trim()).toBe('already');
    });
});
