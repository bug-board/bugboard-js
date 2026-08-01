/**
 * The contract between the build plugins and the runtime.
 *
 * A bundler knows the original file and line of a reporting call while it is
 * transforming the module — before chunking, minification, or anything else
 * that destroys that information. The plugins append the location to the call
 * as one extra argument, and the runtime takes it back off here.
 *
 * Both halves live in this module so they cannot drift: the plugin generates
 * exactly the literal this file knows how to read.
 */

/**
 * Marks an argument as plugin-generated.
 *
 * Reporting methods take `(title, description?, tags?)`, so an appended
 * argument could land in any slot depending on how many the caller passed.
 * Rather than have the plugin pad the gaps — which spread arguments make
 * impossible to get right — the location identifies itself, and the runtime
 * looks only at the final argument. The name is deliberately unusable as an
 * accidental collision.
 */
export const LOCATION_BRAND = '__bugboardLocation';

/** The literal a build plugin appends to a reporting call. */
export interface InjectedLocation {
    [LOCATION_BRAND]: true;
    file: string;
    line: number;
}

/** A resolved source location: where a reporting call was made. */
export interface SourceLocation {
    file: string;
    line: number;
}

/**
 * Whether a value is a location a build plugin produced.
 *
 * Checked rather than trusted: the argument arrives from generated code, and a
 * stale plugin paired with a newer SDK — or a user passing a fourth argument of
 * their own — must fall back to stack capture rather than put nonsense on a
 * card.
 */
function isInjectedLocation(value: unknown): value is InjectedLocation {
    if (typeof value !== 'object' || value === null) return false;
    if ((value as Record<string, unknown>)[LOCATION_BRAND] !== true) return false;

    const { file, line } = value as Partial<InjectedLocation>;
    return typeof file === 'string' && file !== '' && typeof line === 'number' && line >= 1;
}

/**
 * Remove a plugin-injected location from a reporting call's arguments and
 * return it, or return `undefined` and leave the arguments untouched.
 *
 * Mutates `args` so the caller's own arguments keep their original positions —
 * `description` stays the second argument whether or not a plugin ran.
 */
export function takeInjectedLocation(args: unknown[]): SourceLocation | undefined {
    const last = args[args.length - 1];
    if (!isInjectedLocation(last)) return undefined;

    args.pop();
    return { file: last.file, line: last.line };
}

/**
 * Render the argument a build plugin appends. Paths go through
 * `JSON.stringify` so quotes, backslashes, and non-ASCII characters in a
 * filename cannot break out of the literal.
 */
export function formatInjectedLocation(file: string, line: number): string {
    return `{${LOCATION_BRAND}:true,file:${JSON.stringify(file)},line:${line}}`;
}
