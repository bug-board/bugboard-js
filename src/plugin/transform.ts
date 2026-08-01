/**
 * Rewrite reporting calls to carry their own source location.
 *
 * `client.critical('Checkout failed', error)` becomes
 * `client.critical('Checkout failed', error, {__bugboardLocation:true,file:"src/Checkout.tsx",line:42})`.
 *
 * The bundler is holding the original module when this runs, so the file and
 * line are simply known — no source map is produced, published, or uploaded,
 * and the location survives chunking and minification intact because by then
 * it is just a string literal.
 */

import { formatInjectedLocation } from '../injected-location';
import { PRIORITY_SUFFIXES, SEVERITIES } from '../types';
import { tokenize, type Token } from './tokenize';

/** The 16 reporting method names, derived from the same table the client uses. */
const METHOD_NAMES = new Set(
    SEVERITIES.flatMap((severity) =>
        Object.keys(PRIORITY_SUFFIXES).map((suffix) => `${severity}${suffix}`),
    ),
);

/** The package whose `createClient` produces a client worth rewriting. */
const SDK_PACKAGE = 'bugboard';

export interface TransformOptions {
    /**
     * Absolute project root. Reported paths are made relative to it, so a card
     * reads `src/App.tsx` rather than `/Users/you/work/app/src/App.tsx`.
     */
    root?: string;
    /**
     * Extra modules that export a configured client, for when the SDK cannot
     * tell on its own — e.g. `['@/lib/telemetry']`. Modules whose specifier
     * mentions `bugboard` are recognised without configuration.
     */
    clientModules?: readonly string[];
    /**
     * Rewrite any `<identifier>.<method>()` whose method name matches, without
     * checking where the identifier came from. Widens coverage to receivers the
     * import analysis cannot follow, at the cost of possibly rewriting an
     * unrelated call. Defaults to `false`.
     */
    loose?: boolean;
}

export interface TransformOutput {
    code: string;
    /** How many call sites were rewritten. Zero means `code` is unchanged. */
    count: number;
}

/** Cheap pre-filter: no severity word anywhere means nothing to do. */
export function mightContainReport(code: string): boolean {
    return SEVERITIES.some((severity) => code.includes(severity));
}

/** Strip a module specifier's surrounding quotes. */
function unquote(raw: string): string {
    return raw.length >= 2 ? raw.slice(1, -1) : raw;
}

/**
 * Whether a module specifier names something that exports a BugBoard client.
 *
 * The SDK package itself qualifies, as does anything the user declared. Beyond
 * that, a specifier that mentions `bugboard` is taken at its word — the common
 * shape is a small wrapper module (`@/lib/bugboard`, `./bugboard.client`) that
 * configures a client once and exports it.
 */
function exportsClient(specifier: string, clientModules: readonly string[]): boolean {
    if (specifier === SDK_PACKAGE) return true;
    if (clientModules.includes(specifier)) return true;

    return specifier.toLowerCase().includes(SDK_PACKAGE);
}

/**
 * Collect the identifiers in this module that plausibly hold a BugBoard client.
 *
 * Three sources, in order of certainty: a local `createClient()` result, a
 * binding imported from a module that exports a client, and an identifier whose
 * own name says what it is. Anything else is left alone, because appending an
 * argument to a call that turns out not to be ours would corrupt it.
 */
function findClientIdentifiers(
    code: string,
    tokens: Token[],
    clientModules: readonly string[],
): Set<string> {
    const clients = new Set<string>();
    // Local names for the SDK's `createClient`, and for a namespace import of
    // the SDK (`import * as bb from 'bugboard'` → `bb.createClient()`).
    const factories = new Set<string>();
    const namespaces = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token.kind !== 'ident' || token.value !== 'import') continue;

        // Find this statement's specifier: the string token after `from`, or
        // immediately after `import` for a side-effect import (which binds
        // nothing and can be skipped).
        let end = i + 1;
        let specifier: string | undefined;
        let isNamespace = false;
        const bound: { name: string; viaAs: boolean }[] = [];

        for (; end < tokens.length; end++) {
            const t = tokens[end]!;
            if (t.kind === 'value') {
                specifier = unquote(code.slice(t.start, t.end));
                break;
            }
            if (t.kind === 'punct' && (t.value === ';' || t.value === '(')) break;
            if (t.kind === 'punct' && t.value === '*') isNamespace = true;
            if (t.kind === 'ident' && t.value !== 'from' && t.value !== 'type') {
                const previous = tokens[end - 1];
                const viaAs = previous?.kind === 'ident' && previous.value === 'as';
                // `x as y` binds y; drop the x recorded a moment ago.
                if (viaAs) bound.pop();
                bound.push({ name: t.value, viaAs });
            }
        }

        if (specifier === undefined) continue;
        i = end;

        if (specifier === SDK_PACKAGE) {
            for (const { name } of bound) {
                if (isNamespace) namespaces.add(name);
                else factories.add(name);
            }
        }

        if (exportsClient(specifier, clientModules)) {
            for (const { name } of bound) clients.add(name);
        }
    }

    // `const client = createClient(...)`, `let x = bb.createClient(...)`, and
    // the same behind `export`.
    for (let i = 0; i < tokens.length; i++) {
        const name = tokens[i]!;
        const equals = tokens[i + 1];
        if (name.kind !== 'ident' || equals?.kind !== 'punct' || equals.value !== '=') continue;

        const first = tokens[i + 2];
        if (first?.kind !== 'ident') continue;

        if (factories.has(first.value)) {
            clients.add(name.value);
            continue;
        }

        // `<namespace>.createClient(`
        const dot = tokens[i + 3];
        const member = tokens[i + 4];
        if (
            namespaces.has(first.value) &&
            dot?.kind === 'punct' &&
            dot.value === '.' &&
            member?.kind === 'ident' &&
            factories.size === 0 &&
            member.value === 'createClient'
        ) {
            clients.add(name.value);
        }
    }

    // A `createClient` imported and immediately re-exported still deserves the
    // name it was given.
    for (const factory of factories) clients.delete(factory);

    return clients;
}

/** Index of the token closing the bracket opened at `open`, or `-1`. */
function matchBracket(tokens: Token[], open: number): number {
    const opens = new Set(['(', '[', '{']);
    const closes = new Set([')', ']', '}']);

    let depth = 0;
    for (let i = open; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token.kind !== 'punct') continue;
        if (opens.has(token.value)) depth++;
        else if (closes.has(token.value)) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** 1-based line number of a character offset. */
function lineAt(code: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < code.length; i++) {
        if (code[i] === '\n') line++;
    }
    return line;
}

/**
 * Turn a module id into the path a developer would recognise: no query string,
 * forward slashes, and relative to the project root where possible.
 */
export function displayPath(id: string, root?: string): string {
    let path = id;

    const queryOrHash = path.search(/[?#]/);
    if (queryOrHash !== -1) path = path.slice(0, queryOrHash);

    // Bundlers prefix virtual and dependency-injected modules; those are not
    // files anyone can open, but the raw id is still the most useful label.
    path = path.replace(/\\/g, '/');

    if (root) {
        const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
        if (path.startsWith(normalizedRoot + '/')) path = path.slice(normalizedRoot.length + 1);
    }

    return path;
}

/** A stretch of JavaScript inside a file, and where it sits in that file. */
interface Region {
    code: string;
    /** Character offset of the region within the whole file. */
    offset: number;
    /** Newlines before the region, so region lines can be made file-absolute. */
    lineBase: number;
}

/** Whether a module id names a single-file component rather than plain JavaScript. */
export function isSingleFileComponent(id: string): boolean {
    return /\.(vue|svelte)(\?|$)/.test(id);
}

/**
 * The `<script>` bodies of a single-file component.
 *
 * Vue and Svelte components are not JavaScript, but their script blocks are,
 * and — crucially — those blocks still carry the line numbers the developer
 * sees. Editing them here, before the framework compiler runs, is the only
 * point at which a `.vue` or `.svelte` file has a truthful line number to
 * record. A component can hold two (`<script>` plus `<script setup>` in Vue, or
 * `<script module>` in Svelte), so all of them are returned.
 */
function scriptRegions(code: string): Region[] {
    const regions: Region[] = [];
    const pattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

    for (const match of code.matchAll(pattern)) {
        const body = match[1];
        if (body === undefined || match.index === undefined) continue;

        const offset = match.index + match[0].indexOf(body, match[0].indexOf('>'));
        regions.push({ code: body, offset, lineBase: countNewlines(code, offset) });
    }

    return regions;
}

/** Newlines before `offset`. */
function countNewlines(code: string, offset: number): number {
    let count = 0;
    for (let i = 0; i < offset && i < code.length; i++) {
        if (code[i] === '\n') count++;
    }
    return count;
}

/** An edit to make: insert `text` at `at`, both absolute within the file. */
interface Insertion {
    at: number;
    text: string;
}

/**
 * Find the reporting calls in one region and the text to append to each.
 *
 * Returns `null` if the region cannot be lexed, which the caller treats as
 * "leave this alone" rather than as an error.
 */
function collectInsertions(
    region: Region,
    file: string,
    clients: Set<string> | undefined,
): Insertion[] | null {
    const { code, offset, lineBase } = region;

    const tokens = tokenize(code);
    if (!tokens) return null;

    const insertions: Insertion[] = [];

    for (let i = 0; i + 3 < tokens.length; i++) {
        const receiver = tokens[i]!;
        const dot = tokens[i + 1]!;
        const method = tokens[i + 2]!;
        const open = tokens[i + 3]!;

        if (receiver.kind !== 'ident') continue;
        if (dot.kind !== 'punct' || dot.value !== '.') continue;
        if (method.kind !== 'ident' || !METHOD_NAMES.has(method.value)) continue;
        if (open.kind !== 'punct' || open.value !== '(') continue;
        if (clients && !clients.has(receiver.value)) continue;

        // `a.critical.b` is a property chain, not a call we understand.
        const before = tokens[i - 1];
        if (before?.kind === 'punct' && before.value === '.') continue;

        const close = matchBracket(tokens, i + 3);
        if (close === -1) continue;

        const closeToken = tokens[close]!;
        const inner = code.slice(open.end, closeToken.start);

        // `critical()` has no title, so it is not a call we can help; appending
        // to it would silently become the title.
        if (inner.trim() === '') continue;

        // Respect an existing trailing comma rather than emitting `,,`.
        const separator = /,\s*$/.test(inner) ? '' : ',';

        insertions.push({
            at: offset + closeToken.start,
            text: separator + formatInjectedLocation(file, lineBase + lineAt(code, receiver.start)),
        });

        i = close;
    }

    return insertions;
}

/**
 * Append a source location to every reporting call in `code`.
 *
 * Returns `null` when there is nothing to do, or when the module cannot be
 * lexed — an unreadable file is left exactly as it was found, because a build
 * plugin that mangles source is far worse than one that misses a location.
 */
export function transform(
    code: string,
    id: string,
    options: TransformOptions = {},
): TransformOutput | null {
    if (!mightContainReport(code)) return null;

    const regions: Region[] = isSingleFileComponent(id)
        ? scriptRegions(code)
        : [{ code, offset: 0, lineBase: 0 }];
    if (regions.length === 0) return null;

    // Clients are gathered across every region first: a Vue component can
    // import the client in `<script setup>` and use it in `<script>`, and
    // neither block sees the other's bindings on its own.
    let clients: Set<string> | undefined;
    if (!options.loose) {
        clients = new Set();
        for (const region of regions) {
            const tokens = tokenize(region.code);
            if (!tokens) continue;
            for (const name of findClientIdentifiers(
                region.code,
                tokens,
                options.clientModules ?? [],
            )) {
                clients.add(name);
            }
        }
        if (clients.size === 0) return null;
    }

    const file = displayPath(id, options.root);
    const insertions: Insertion[] = [];

    for (const region of regions) {
        const found = collectInsertions(region, file, clients);
        // A whole plain module that cannot be lexed is left untouched; one bad
        // script block in a component only costs that block.
        if (found === null) {
            if (regions.length === 1) return null;
            continue;
        }
        insertions.push(...found);
    }

    if (insertions.length === 0) return null;

    insertions.sort((a, b) => a.at - b.at);

    // Apply back to front so each offset still refers to the original source.
    let output = code;
    for (let i = insertions.length - 1; i >= 0; i--) {
        const { at, text } = insertions[i]!;
        output = output.slice(0, at) + text + output.slice(at);
    }

    return { code: output, count: insertions.length };
}
