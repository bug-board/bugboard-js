/**
 * A line-preserving source map for the injection transform.
 *
 * Every edit the plugin makes is a single-line insertion — the appended
 * location literal contains no newlines — so output line *n* is always input
 * line *n*. That makes a line-for-line identity map exactly correct, which is
 * all a stack trace needs, and it means the plugin can hand the bundler a
 * truthful map without depending on `magic-string` to track the edits.
 *
 * Columns on rewritten lines are not mapped. Nothing downstream of a build
 * plugin resolves columns for error reporting, and the alternative is a
 * dependency in a package that otherwise ships none.
 */

/** Base64 alphabet used by source-map VLQ. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * A single VLQ-encoded segment `[0, 0, 0, 0]` — "output column 0 comes from
 * source 0, the same line, column 0". Field deltas are all zero.
 */
const SEGMENT_SAME_LINE = BASE64[0]!.repeat(4);

/**
 * `[0, 0, +1, 0]` — the same, but advancing one line in the source. `1 << 1`
 * is 2, so the line delta encodes as the third base64 character.
 */
const SEGMENT_NEXT_LINE = `${BASE64[0]}${BASE64[0]}${BASE64[2]}${BASE64[0]}`;

/** The `mappings` field for a transform that moved no line. */
export function identityMappings(code: string): string {
    let lines = 1;
    for (let i = 0; i < code.length; i++) {
        if (code[i] === '\n') lines++;
    }

    return SEGMENT_SAME_LINE + `;${SEGMENT_NEXT_LINE}`.repeat(lines - 1);
}

/** A source map describing the injection transform for one module. */
export function identitySourceMap(code: string, id: string): Record<string, unknown> {
    return {
        version: 3,
        sources: [id],
        names: [],
        mappings: identityMappings(code),
    };
}
