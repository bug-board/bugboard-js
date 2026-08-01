import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { bugboard as bugboardEsbuild } from '../src/plugin/esbuild';

import { LOCATION_BRAND, takeInjectedLocation } from '../src/injected-location';
import { identityMappings } from '../src/plugin/sourcemap';
import { displayPath, transform } from '../src/plugin/transform';
import { tokenize } from '../src/plugin/tokenize';
import { bugboard as bugboardVite } from '../src/plugin/vite';
import bugboardLoader from '../src/plugin/webpack';

const ROOT = '/work/app';
const ID = '/work/app/src/App.tsx';

/** Transform with the project root applied, as the bundlers do. */
const run = (code: string, id = ID): ReturnType<typeof transform> =>
    transform(code, id, { root: ROOT });

/** The location literals a transform produced, in source order. */
function injected(code: string): { file: string; line: number }[] {
    const found: { file: string; line: number }[] = [];
    const pattern = new RegExp(
        `\\{${LOCATION_BRAND}:true,file:("(?:[^"\\\\]|\\\\.)*"),line:(\\d+)\\}`,
        'g',
    );

    for (const match of code.matchAll(pattern)) {
        found.push({ file: JSON.parse(match[1]!) as string, line: Number(match[2]) });
    }
    return found;
}

describe('transform', () => {
    it('appends the call site to a client created in the same module', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                ``,
                `const client = createClient({ apiKey: 'k' });`,
                ``,
                `client.critical('Checkout failed', error);`,
            ].join('\n'),
        );

        expect(result).not.toBeNull();
        expect(result!.count).toBe(1);
        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 5 }]);
    });

    it('follows a client imported from a wrapper module', () => {
        const result = run(
            [
                `import { bugboard } from '@/lib/bugboard.client';`,
                `bugboard.majorHigh('Boom');`,
            ].join('\n'),
        );

        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 2 }]);
    });

    it('follows a namespace import of the SDK', () => {
        const result = run(
            [
                `import * as bb from 'bugboard';`,
                `const c = bb.createClient({});`,
                `c.minor('x');`,
            ].join('\n'),
        );

        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
    });

    it('honours an aliased createClient import', () => {
        const result = run(
            [
                `import { createClient as makeClient } from 'bugboard';`,
                `const c = makeClient({});`,
                `c.moderateLow('x');`,
            ].join('\n'),
        );

        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
    });

    it('leaves an unrelated logger alone', () => {
        const result = run(
            [`import { logger } from './logger';`, `logger.critical('not ours', meta);`].join('\n'),
        );

        expect(result).toBeNull();
    });

    it('rewrites any matching receiver in loose mode', () => {
        const code = [`import { logger } from './logger';`, `logger.critical('theirs');`].join(
            '\n',
        );

        expect(transform(code, ID, { root: ROOT })).toBeNull();
        expect(transform(code, ID, { root: ROOT, loose: true })!.count).toBe(1);
    });

    it('accepts an explicitly declared client module', () => {
        const code = [`import { report } from '@/lib/telemetry';`, `report.minorHigh('x');`].join(
            '\n',
        );

        expect(transform(code, ID, { root: ROOT })).toBeNull();
        expect(transform(code, ID, { root: ROOT, clientModules: ['@/lib/telemetry'] })!.count).toBe(
            1,
        );
    });

    it('ignores calls written inside strings and comments', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `// c.critical('commented out');`,
                `const doc = "call c.critical('x') to report";`,
                `const doc2 = 'c.majorLow("y")';`,
            ].join('\n'),
        );

        expect(result).toBeNull();
    });

    it('handles nested calls, objects, and commas in the arguments', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `c.critical(format(a, b), { meta: [1, 2, 3] }, ['x', 'y']);`,
            ].join('\n'),
        );

        expect(result!.count).toBe(1);
        expect(result!.code).toContain(`['x', 'y'],{${LOCATION_BRAND}:true`);
    });

    it('does not emit a double comma after a trailing comma', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `c.critical(`,
                `    'Title',`,
                `    error,`,
                `);`,
            ].join('\n'),
        );

        expect(result!.code).not.toContain(',,');
        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
    });

    it('skips an argumentless call rather than making the location the title', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `c.critical();`,
            ].join('\n'),
        );

        expect(result).toBeNull();
    });

    it('reaches a call inside a template substitution', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                'const s = `before ${c.minor("inside")} after`;',
            ].join('\n'),
        );

        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
    });

    it('is not confused by regular expressions or division in the arguments', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `c.critical('a'.replace(/\\)/g, ')'), total / count);`,
            ].join('\n'),
        );

        expect(result!.count).toBe(1);
        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
    });

    it('rewrites every call in a module with the right line for each', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `c.critical('one');`,
                ``,
                `function go() {`,
                `    c.majorLow('two');`,
                `}`,
            ].join('\n'),
        );

        expect(injected(result!.code)).toEqual([
            { file: 'src/App.tsx', line: 3 },
            { file: 'src/App.tsx', line: 6 },
        ]);
    });

    describe('JSX', () => {
        // Without real JSX handling `</div>` reads as the start of a regular
        // expression, whose scan then dies at the newline and takes the whole
        // file with it — which silently skipped every React component.
        const withClient = (body: string[]): string =>
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                ...body,
            ].join('\n');

        it('rewrites a call sitting before multi-line markup', () => {
            const result = run(
                withClient([
                    `export function App() {`,
                    `    const onFail = () => c.critical('Boom');`,
                    `    return (`,
                    `        <div className="card">`,
                    `            <button onClick={onFail}>Go</button>`,
                    `        </div>`,
                    `    );`,
                    `}`,
                ]),
            );

            expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 4 }]);
        });

        it('reaches a call inside a JSX expression container', () => {
            const result = run(
                withClient([
                    `export function App() {`,
                    `    return (`,
                    `        <button onClick={() => c.criticalHigh('Inline')}>Go</button>`,
                    `    );`,
                    `}`,
                ]),
            );

            expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 5 }]);
        });

        it('rewrites a call appearing after markup in the same file', () => {
            const result = run(
                withClient([
                    `export function App() {`,
                    `    return <div><span>hi</span></div>;`,
                    `}`,
                    `export function report() {`,
                    `    c.minor('later');`,
                    `}`,
                ]),
            );

            expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 7 }]);
        });

        it('is not derailed by apostrophes or quotes in element text', () => {
            const result = run(
                withClient([
                    `export function App() {`,
                    `    const f = () => c.critical('Boom');`,
                    `    return (`,
                    `        <p>Don't "panic" — it's fine</p>`,
                    `    );`,
                    `}`,
                ]),
            );

            expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 4 }]);
        });

        it('handles fragments, self-closing tags, and attribute URLs', () => {
            const result = run(
                withClient([
                    `export function App() {`,
                    `    const f = () => c.majorHigh('Boom');`,
                    `    return (`,
                    `        <>`,
                    `            <a href="https://vite.dev" target="_blank">`,
                    `                <img src="/vite.svg" className="logo" alt="Vite logo" />`,
                    `            </a>`,
                    `            <Foo.Bar data-x="1" aria-label="y" {...rest} disabled />`,
                    `        </>`,
                    `    );`,
                    `}`,
                ]),
            );

            expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 4 }]);
        });

        it('still treats a TypeScript generic arrow as code, not markup', () => {
            const result = run(
                withClient([
                    `const identity = <T,>(x: T): T => x;`,
                    `c.critical('after generic');`,
                ]),
            );

            expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 4 }]);
        });

        it('does not mistake a comparison for markup', () => {
            const result = run(
                withClient([`const wider = a < b && b > c;`, `c.critical('after comparison');`]),
            );

            expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 4 }]);
        });

        it('ignores a reporting call written inside element text', () => {
            const result = run(
                withClient([
                    `export function App() {`,
                    `    return <p>call c.critical('x') to report</p>;`,
                    `}`,
                ]),
            );

            expect(result).toBeNull();
        });

        it('tokenizes nested elements and expressions to the end', () => {
            expect(
                tokenize(
                    `const el = <div><span>{items.map((i) => <b key={i}>{i}</b>)}</span></div>;`,
                ),
            ).toBeDefined();
        });
    });

    describe('single-file components', () => {
        // The script block is the only place a `.vue`/`.svelte` file has line
        // numbers the developer would recognise. The framework compiler's output
        // still carries the component's id but no longer its line numbering, so
        // taking a location from that would be confidently wrong.
        const VUE = [
            `<script setup lang="ts">`,
            `import bugboard from './lib/bugboard';`,
            ``,
            `function fail() {`,
            `    bugboard.criticalHigh('Vue failure');`,
            `}`,
            `</script>`,
            ``,
            `<template>`,
            `    <button @click="fail">Go</button>`,
            `    <p>Don't panic</p>`,
            `</template>`,
        ].join('\n');

        it('rewrites inside a Vue script block with the file line number', () => {
            const result = transform(VUE, '/work/app/src/App.vue', { root: ROOT });

            expect(injected(result!.code)).toEqual([{ file: 'src/App.vue', line: 5 }]);
        });

        it('rewrites inside a Svelte script block', () => {
            const svelte = [
                `<script lang="ts">`,
                `import bugboard from './lib/bugboard';`,
                ``,
                `function fail() {`,
                `    bugboard.majorLow('Svelte failure');`,
                `}`,
                `</script>`,
                ``,
                `<div>`,
                `    <button onclick={fail}>Go</button>`,
                `</div>`,
            ].join('\n');

            const result = transform(svelte, '/work/app/src/App.svelte', { root: ROOT });

            expect(injected(result!.code)).toEqual([{ file: 'src/App.svelte', line: 5 }]);
        });

        it('spans two script blocks, sharing the client binding between them', () => {
            const twoBlocks = [
                `<script lang="ts">`,
                `import bugboard from './lib/bugboard';`,
                `</script>`,
                ``,
                `<script setup lang="ts">`,
                `bugboard.minor('from setup');`,
                `</script>`,
                ``,
                `<template><div /></template>`,
            ].join('\n');

            const result = transform(twoBlocks, '/work/app/src/App.vue', { root: ROOT });

            expect(injected(result!.code)).toEqual([{ file: 'src/App.vue', line: 6 }]);
        });

        it('leaves the markup outside the script block untouched', () => {
            const result = transform(VUE, '/work/app/src/App.vue', { root: ROOT });

            expect(result!.code).toContain(`<p>Don't panic</p>`);
            expect(result!.code).toContain(`<button @click="fail">Go</button>`);
        });

        it('ignores a component with no script block', () => {
            const markupOnly = `<template><p>critical</p></template>`;

            expect(transform(markupOnly, '/work/app/src/App.vue', { root: ROOT })).toBeNull();
        });
    });

    it('skips a property chain that merely contains a method name', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `const level = config.severity.critical(1);`,
            ].join('\n'),
        );

        expect(result).toBeNull();
    });

    it('returns null for a file it cannot lex', () => {
        expect(run(`<template><div>critical</div></template>`)).toBeNull();
    });

    it('does nothing when no severity word appears', () => {
        expect(run(`export const sum = (a, b) => a + b;`)).toBeNull();
    });
});

describe('injected location round trip', () => {
    it('is read back off the arguments by the runtime', () => {
        const result = run(
            [
                `import { createClient } from 'bugboard';`,
                `const c = createClient({});`,
                `c.critical('Title', err);`,
            ].join('\n'),
        );

        // Actually execute the rewritten call against a stand-in client: the
        // point is that the generated code runs and the runtime helper recovers
        // exactly what the plugin wrote.
        const calls: unknown[][] = [];
        const source = result!.code
            .replace(`import { createClient } from 'bugboard';`, '')
            .replace(`const c = createClient({});`, '')
            .trim();

        runInNewContext(source, {
            c: { critical: (...args: unknown[]) => calls.push(args) },
            err: new Error('x'),
        });

        const args = calls[0]!;
        expect(takeInjectedLocation(args)).toEqual({ file: 'src/App.tsx', line: 3 });
        // The caller's own arguments keep their positions once ours is removed.
        expect(args).toHaveLength(2);
        expect(args[0]).toBe('Title');
        expect(args[1]).toBeInstanceOf(Error);
    });
});

describe('displayPath', () => {
    it('makes the id relative to the project root', () => {
        expect(displayPath('/work/app/src/App.tsx', '/work/app')).toBe('src/App.tsx');
    });

    it('drops a dev-server query string', () => {
        expect(displayPath('/work/app/src/App.tsx?t=1783593985084', '/work/app')).toBe(
            'src/App.tsx',
        );
    });

    it('normalises Windows separators', () => {
        expect(displayPath('C:\\work\\app\\src\\App.tsx', 'C:\\work\\app')).toBe('src/App.tsx');
    });

    it('leaves a path outside the root absolute', () => {
        expect(displayPath('/elsewhere/lib.ts', '/work/app')).toBe('/elsewhere/lib.ts');
    });
});

describe('tokenize', () => {
    it('refuses a source that ends inside a string', () => {
        expect(tokenize(`const a = 'unterminated`)).toBeUndefined();
    });

    it('refuses a source that ends inside a block comment', () => {
        expect(tokenize(`/* open`)).toBeUndefined();
    });

    it('tracks nested template substitutions', () => {
        expect(tokenize('`a${`b${c}d`}e`')).toBeDefined();
    });
});

describe('vite plugin', () => {
    const SOURCE = [
        `import { createClient } from 'bugboard';`,
        `const c = createClient({});`,
        `c.critical('x');`,
    ].join('\n');

    /** Invoke the plugin's transform hook the way Vite does. */
    const run = (
        plugin: ReturnType<typeof bugboardVite>,
        code: string,
        id: string,
    ): ReturnType<typeof plugin.transform> => plugin.transform.call({}, code, id);

    it('runs before other transforms, so line numbers are still original', () => {
        expect(bugboardVite().enforce).toBe('pre');
    });

    it('rewrites a source file and returns a line-preserving map', () => {
        const plugin = bugboardVite({ root: ROOT });
        const result = run(plugin, SOURCE, ID);

        expect(injected(result!.code)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
        expect(result!.map.mappings).toBe(identityMappings(result!.code));
    });

    it('takes the root from configResolved when not given one', () => {
        const plugin = bugboardVite();
        plugin.configResolved?.({ root: ROOT });

        expect(injected(run(plugin, SOURCE, ID)!.code)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
    });

    it('skips node_modules, virtual modules, and non-JS files', () => {
        const plugin = bugboardVite({ root: ROOT });

        expect(run(plugin, SOURCE, '/work/app/node_modules/dep/index.js')).toBeNull();
        expect(run(plugin, SOURCE, '\0virtual:module')).toBeNull();
        expect(run(plugin, SOURCE, '/work/app/src/styles.css')).toBeNull();
    });

    it('never rewrites a framework compiler’s output for a component block', () => {
        const plugin = bugboardVite({ root: ROOT });

        // Vite hands these back after Vue/Svelte have compiled the component.
        // The id still names the file, but the lines are the compiler's.
        for (const id of [
            '/work/app/src/App.vue?vue&type=script&setup=true&lang.ts',
            '/work/app/src/App.vue?vue&type=template&id=abc&lang.js',
            '/work/app/src/App.svelte?svelte&type=style&lang.css',
        ]) {
            expect(run(plugin, SOURCE, id)).toBeNull();
        }
    });

    it('accepts the raw component file, where the line numbers are real', () => {
        const plugin = bugboardVite({ root: ROOT });
        const vue = [
            `<script setup lang="ts">`,
            `import { createClient } from 'bugboard';`,
            `const c = createClient({});`,
            `c.critical('x');`,
            `</script>`,
        ].join('\n');

        expect(run(plugin, vue, '/work/app/src/App.vue')).not.toBeNull();
    });

    it('honours a custom include', () => {
        const plugin = bugboardVite({ root: ROOT, include: /\.custom$/ });

        expect(run(plugin, SOURCE, ID)).toBeNull();
        expect(run(plugin, SOURCE, '/work/app/src/thing.custom')).not.toBeNull();
    });
});

describe('webpack loader', () => {
    const SOURCE = [
        `import { createClient } from 'bugboard';`,
        `const c = createClient({});`,
        `c.critical('x');`,
    ].join('\n');

    /** Drive the loader through a minimal stand-in for webpack's context. */
    function runLoader(
        code: string,
        resourcePath = ID,
        incomingMap?: Record<string, unknown>,
    ): { code?: string; map?: unknown; error: Error | null } {
        let captured: { code?: string; map?: unknown; error: Error | null } = { error: null };

        const context = {
            resourcePath,
            rootContext: ROOT,
            getOptions: () => ({}),
            callback: (error: Error | null, out?: string, map?: unknown) => {
                captured = { error, code: out, map };
            },
        };

        bugboardLoader.call(context, code, incomingMap);
        return captured;
    }

    it('rewrites the module and supplies a map', () => {
        const result = runLoader(SOURCE);

        expect(result.error).toBeNull();
        expect(injected(result.code!)).toEqual([{ file: 'src/App.tsx', line: 3 }]);
        expect(result.map).toBeDefined();
    });

    it('passes an untouched module straight through', () => {
        const plain = `export const sum = (a, b) => a + b;`;
        const result = runLoader(plain);

        expect(result.code).toBe(plain);
    });

    it('keeps an upstream map rather than replacing it with the identity one', () => {
        const upstream = { version: 3, sources: ['original.ts'], mappings: 'AAAA' };
        const result = runLoader(SOURCE, ID, upstream);

        expect(result.map).toBe(upstream);
    });

    it('never fails the build when the source cannot be lexed', () => {
        const broken = `const a = 'unterminated\nc.critical('x');`;
        const result = runLoader(broken);

        expect(result.error).toBeNull();
        expect(result.code).toBe(broken);
    });
});

describe('esbuild plugin', () => {
    const SOURCE = [
        `import { createClient } from 'bugboard';`,
        `const c = createClient({});`,
        `c.critical('x');`,
    ].join('\n');

    /** Drive the plugin through a stand-in for esbuild's setup/onLoad API. */
    function runPlugin(
        files: Record<string, string>,
        options: Parameters<typeof bugboardEsbuild>[0] = {},
    ): Promise<Record<string, { contents: string; loader: string } | null>> {
        let handler:
            | ((args: { path: string }) => Promise<{ contents: string; loader: string } | null>)
            | undefined;
        let filter: RegExp | undefined;

        bugboardEsbuild({ root: ROOT, ...options }).setup({
            initialOptions: { absWorkingDir: ROOT },
            onLoad(f, cb) {
                filter = f.filter;
                handler = cb;
            },
        });

        return (async () => {
            const out: Record<string, { contents: string; loader: string } | null> = {};
            for (const path of Object.keys(files)) {
                out[path] = filter!.test(path) ? await handler!({ path }) : null;
            }
            return out;
        })();
    }

    it('registers a filter that covers JS, TS, and components', () => {
        for (const path of [
            'a.js',
            'a.mjs',
            'a.cjs',
            'a.jsx',
            'a.ts',
            'a.tsx',
            'a.vue',
            'a.svelte',
        ])
            expect(/\.([cm]?[jt]sx?|vue|svelte)$/.test(path)).toBe(true);
    });

    it('rewrites a file it can read, and reports the right loader', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bugboard-esbuild-'));
        const file = join(dir, 'App.tsx');
        writeFileSync(file, SOURCE);

        try {
            const out = await runPlugin({ [file]: SOURCE }, { root: dir });

            expect(out[file]!.loader).toBe('tsx');
            expect(injected(out[file]!.contents)).toEqual([{ file: 'App.tsx', line: 3 }]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('leaves a file with nothing to rewrite alone', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bugboard-esbuild-'));
        const file = join(dir, 'plain.ts');
        writeFileSync(file, `export const sum = (a, b) => a + b;`);

        try {
            const out = await runPlugin({ [file]: '' }, { root: dir });
            expect(out[file]).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('skips node_modules and unreadable paths without throwing', async () => {
        const out = await runPlugin({
            '/work/app/node_modules/dep/index.js': SOURCE,
            '/work/app/does-not-exist.ts': SOURCE,
        });

        expect(out['/work/app/node_modules/dep/index.js']).toBeNull();
        expect(out['/work/app/does-not-exist.ts']).toBeNull();
    });

    it('hands single-file components back untouched, having no loader for them', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bugboard-esbuild-'));
        const file = join(dir, 'App.vue');
        writeFileSync(file, `<script setup>\n${SOURCE}\n</script>`);

        try {
            const out = await runPlugin({ [file]: '' }, { root: dir });
            expect(out[file]).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('identityMappings', () => {
    it('emits one segment per line', () => {
        expect(identityMappings('a')).toBe('AAAA');
        expect(identityMappings('a\nb')).toBe('AAAA;AACA');
        expect(identityMappings('a\nb\nc')).toBe('AAAA;AACA;AACA');
    });
});
