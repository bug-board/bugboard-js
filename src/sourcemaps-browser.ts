/**
 * Browser source-map resolution.
 *
 * Unlike Node, a browser has no maps on hand — they are files on your origin,
 * and only if you chose to deploy them. When you have, this turns a frame in
 * `/assets/index-a3f2b1.js` back into `src/checkout/Payment.tsx:42` by fetching
 * the chunk's `.js.map` and reading it.
 *
 * This is the weakest of the SDK's three strategies and is off by default:
 *
 * - It only works if the maps are actually served, which publishes your source.
 * - It costs a network round trip, so a report sent before the map arrives goes
 *   out with its bundled coordinates.
 *
 * Prefer the build plugin (`bugboard/vite`), which needs no maps at all and is
 * exact. This exists for builds the plugin cannot cover, and to resolve frames
 * from errors thrown outside your own code.
 */

import type { CapturedLocation, SourceLocation } from './location';

/** Base64 alphabet used by source-map VLQ. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_VALUES = /* @__PURE__ */ (() => {
    const table = new Int32Array(128).fill(-1);
    for (let i = 0; i < BASE64.length; i++) table[BASE64.charCodeAt(i)] = i;
    return table;
})();

/** How many chunk maps to keep decoded. Bundles are few; maps are large. */
const MAX_CACHED_MAPS = 8;

/** Bytes of the chunk tail to read when hunting for `sourceMappingURL`. */
const TAIL_BYTES = 1024;

/** Give up on a map rather than delay a report indefinitely. */
const FETCH_TIMEOUT_MS = 3000;

/** One line of a decoded map: parallel arrays, sorted by generated column. */
interface DecodedLine {
    columns: Int32Array;
    sources: Int32Array;
    lines: Int32Array;
}

interface DecodedMap {
    sources: string[];
    lines: Map<number, DecodedLine>;
}

/**
 * Decoded maps by chunk URL. A `null` entry records a chunk we already failed
 * to resolve — a 404 from a build that ships no maps must cost one request,
 * not one per report.
 */
const cache = new Map<string, DecodedMap | null>();

/** In-flight lookups, so a burst of errors in one chunk shares a single fetch. */
const pending = new Map<string, Promise<DecodedMap | null>>();

/** Decode a base64 VLQ field, returning the value and the next read position. */
function decodeVlq(text: string, start: number): { value: number; next: number } | undefined {
    let result = 0;
    let shift = 0;
    let i = start;

    for (;;) {
        if (i >= text.length) return undefined;
        const digit = BASE64_VALUES[text.charCodeAt(i)] ?? -1;
        if (digit === -1) return undefined;
        i++;

        result += (digit & 31) << shift;
        if ((digit & 32) === 0) break;
        shift += 5;
    }

    // The low bit is the sign, so the magnitude is the rest shifted down.
    const value = result & 1 ? -(result >>> 1) : result >>> 1;
    return { value, next: i };
}

/**
 * Decode a map's `mappings` into per-line lookup tables.
 *
 * Only the fields needed to name a location are kept — generated column,
 * source index, original line. Original columns and symbol names are skipped,
 * which roughly halves what a large bundle's map costs to hold.
 */
function decodeMappings(mappings: string): Map<number, DecodedLine> {
    const lines = new Map<number, DecodedLine>();

    let sourceIndex = 0;
    let sourceLine = 0;
    let generatedLine = 0;
    let generatedColumn = 0;
    let i = 0;

    let columns: number[] = [];
    let sources: number[] = [];
    let originals: number[] = [];

    const commitLine = (): void => {
        if (columns.length > 0) {
            lines.set(generatedLine, {
                columns: Int32Array.from(columns),
                sources: Int32Array.from(sources),
                lines: Int32Array.from(originals),
            });
        }
        columns = [];
        sources = [];
        originals = [];
    };

    while (i < mappings.length) {
        const char = mappings[i]!;

        if (char === ';') {
            commitLine();
            generatedLine++;
            generatedColumn = 0;
            i++;
            continue;
        }
        if (char === ',') {
            i++;
            continue;
        }

        const column = decodeVlq(mappings, i);
        if (!column) break;
        generatedColumn += column.value;
        i = column.next;

        // A one-field segment marks generated code with no origin; skip it.
        if (i >= mappings.length || mappings[i] === ',' || mappings[i] === ';') continue;

        const source = decodeVlq(mappings, i);
        if (!source) break;
        sourceIndex += source.value;
        i = source.next;

        const line = decodeVlq(mappings, i);
        if (!line) break;
        sourceLine += line.value;
        i = line.next;

        // Original column, and optionally a name index — read past both.
        const originalColumn = decodeVlq(mappings, i);
        if (!originalColumn) break;
        i = originalColumn.next;

        if (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
            const name = decodeVlq(mappings, i);
            if (!name) break;
            i = name.next;
        }

        columns.push(generatedColumn);
        sources.push(sourceIndex);
        originals.push(sourceLine);
    }

    commitLine();
    return lines;
}

/**
 * Tidy a map's source path into something recognisable.
 *
 * Bundlers namespace their sources — webpack writes
 * `webpack://my-app/./src/App.tsx`, Vite writes paths relative to the project
 * root, and both may carry a `sourceRoot`. What a developer wants to read is
 * `src/App.tsx`.
 */
function cleanSourcePath(source: string, sourceRoot?: string): string {
    let path = sourceRoot ? `${sourceRoot.replace(/\/$/, '')}/${source}` : source;

    // `webpack://name/./src/App.tsx` and `webpack:///./src/App.tsx`.
    path = path.replace(/^webpack:\/\/[^/]*\//, '');
    path = path.replace(/^(\.\.?\/)+/, '');

    const withoutOrigin = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/]*(\/.*)$/.exec(path);
    if (withoutOrigin?.[1] !== undefined) path = withoutOrigin[1];

    return path;
}

/** `fetch` with a timeout, resolving to `undefined` on any failure. */
async function get(url: string, headers?: HeadersInit): Promise<Response | undefined> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(url, { headers, signal: controller.signal });
            return response.ok ? response : undefined;
        } finally {
            clearTimeout(timer);
        }
    } catch {
        return undefined;
    }
}

/**
 * Find the map URL for a chunk.
 *
 * The `sourceMappingURL` comment is authoritative, and it lives at the very end
 * of the file — so ask for the last kilobyte rather than re-downloading a
 * multi-megabyte bundle. Hosts that ignore `Range` return the whole file and
 * the tail is taken from that instead. Failing all of that, the conventional
 * `<chunk>.map` is worth one try.
 */
async function findMapUrl(chunkUrl: string): Promise<string | undefined> {
    const response = await get(chunkUrl, { Range: `bytes=-${TAIL_BYTES}` });

    if (response) {
        const body = await response.text().catch(() => '');
        const tail = body.slice(-TAIL_BYTES);
        const match = /\/\/[#@]\s*sourceMappingURL=(\S+)/.exec(tail);

        if (match?.[1]) {
            const url = match[1];
            if (url.startsWith('data:')) return url;
            try {
                return new URL(url, chunkUrl).href;
            } catch {
                return undefined;
            }
        }
    }

    return `${chunkUrl}.map`;
}

/** Read an inline `data:` map without a network request. */
function decodeDataUrl(url: string): string | undefined {
    const comma = url.indexOf(',');
    if (comma === -1) return undefined;

    const meta = url.slice(0, comma);
    const body = url.slice(comma + 1);

    try {
        return meta.includes(';base64') ? atob(body) : decodeURIComponent(body);
    } catch {
        return undefined;
    }
}

/** Fetch and decode the map for one chunk, memoised including failures. */
async function loadMap(chunkUrl: string): Promise<DecodedMap | null> {
    const cached = cache.get(chunkUrl);
    if (cached !== undefined) return cached;

    const inFlight = pending.get(chunkUrl);
    if (inFlight) return inFlight;

    const work = (async (): Promise<DecodedMap | null> => {
        try {
            const mapUrl = await findMapUrl(chunkUrl);
            if (!mapUrl) return null;

            let raw: string | undefined;
            if (mapUrl.startsWith('data:')) {
                raw = decodeDataUrl(mapUrl);
            } else {
                const response = await get(mapUrl);
                raw = await response?.text().catch(() => undefined);
            }
            if (!raw) return null;

            const parsed = JSON.parse(raw) as {
                sources?: unknown;
                sourceRoot?: unknown;
                mappings?: unknown;
            };
            if (!Array.isArray(parsed.sources) || typeof parsed.mappings !== 'string') return null;

            const sourceRoot =
                typeof parsed.sourceRoot === 'string' ? parsed.sourceRoot : undefined;

            return {
                sources: parsed.sources.map((source) =>
                    cleanSourcePath(String(source), sourceRoot),
                ),
                lines: decodeMappings(parsed.mappings),
            };
        } catch {
            return null;
        }
    })();

    pending.set(chunkUrl, work);

    const result = await work;
    pending.delete(chunkUrl);

    // Bound the cache; a null result is worth keeping so a mapless build is
    // only probed once.
    if (cache.size >= MAX_CACHED_MAPS) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(chunkUrl, result);

    return result;
}

/** The last segment at or before `column`, via binary search. */
function lookup(line: DecodedLine, column: number): number | undefined {
    let low = 0;
    let high = line.columns.length - 1;
    let found: number | undefined;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (line.columns[mid]! <= column) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return found;
}

/**
 * Resolve a captured location through its chunk's source map.
 *
 * Returns `undefined` when there is no map, it cannot be read, or it has no
 * mapping for this position — in every case the caller keeps what it had.
 * Never throws and never rejects.
 */
export async function resolveViaSourceMap(
    location: CapturedLocation,
): Promise<SourceLocation | undefined> {
    try {
        // Without a column there is nothing to look up: a minified chunk puts
        // every call on line 1, so the column is the only distinguishing part.
        if (location.column === undefined) return undefined;
        if (!/^https?:\/\//.test(location.raw)) return undefined;

        const chunkUrl = location.raw.replace(/[?#].*$/, '');
        const map = await loadMap(chunkUrl);
        if (!map) return undefined;

        const line = map.lines.get(location.line - 1);
        if (!line) return undefined;

        const index = lookup(line, location.column - 1);
        if (index === undefined) return undefined;

        const file = map.sources[line.sources[index]!];
        if (file === undefined) return undefined;

        return { file, line: line.lines[index]! + 1 };
    } catch {
        return undefined;
    }
}

/** Discard cached maps. Exposed for tests. */
export function clearSourceMapCache(): void {
    cache.clear();
    pending.clear();
}
