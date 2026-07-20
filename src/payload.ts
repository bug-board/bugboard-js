import type { ResolvedConfig } from './config';
import type { SourceLocation } from './location';
import type { Priority, ReportPayload, Severity, TagsInput } from './types';

/** Server caps (API reference §4). Clamped client-side so a report never 422s on size. */
const MAX_TITLE_LENGTH = 255;
const MAX_TAG_LENGTH = 50;

/**
 * The server rejects descriptions over 65 535 characters; the SDK truncates
 * well below that cap so multi-byte encodings can never push the wire size over.
 */
const MAX_DESCRIPTION_LENGTH = 60_000;

/** Appended when a description is clamped, so a cut-off dump reads as truncated. */
const TRUNCATION_MARKER = '\n… truncated';

/** Indent for stringified descriptions. The PHP SDK re-indents to match. */
const JSON_INDENT = 2;

/**
 * Turn the `description` argument into text: strings pass through, `Error`s
 * contribute their message + stack, anything else is stringified as JSON.
 */
function describe(description: unknown): string | undefined {
    if (description === null || description === undefined) return undefined;

    const text = (
        description instanceof Error
            ? errorText(description)
            : typeof description === 'string'
              ? description
              : stringify(description)
    ).trim();

    if (text === '') return undefined;
    if (text.length <= MAX_DESCRIPTION_LENGTH) return text;

    // Reserve the marker's length inside the cap, so the result is exactly
    // MAX_DESCRIPTION_LENGTH and never over.
    return text.slice(0, MAX_DESCRIPTION_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/** An `Error`'s message + stack, without repeating the message. */
function errorText(error: Error): string {
    const stack = error.stack ?? '';
    // V8 stacks begin with "name: message" — avoid repeating the message.
    return stack.includes(error.message) ? stack : `${error.message}\n${stack}`.trim();
}

function stringify(value: unknown): string {
    if (typeof value !== 'object' || value === null) return String(value);
    try {
        return JSON.stringify(value, cycleSafeReplacer(), JSON_INDENT) ?? label(value);
    } catch {
        return label(value);
    }
}

/**
 * A `JSON.stringify` replacer that survives what a plain stringify throws on
 * or silently drops: cycles, `bigint`, functions, `Map`/`Set`, and nested
 * `Error`s — whose `message`/`stack` are non-enumerable, so a caught error
 * tucked inside a context object would otherwise render as `{}`.
 */
function cycleSafeReplacer(): (this: unknown, key: string, value: unknown) => unknown {
    // The chain of holders from the root down to the value being visited.
    // `JSON.stringify` calls the replacer with the holder as `this`, so finding
    // `this` in the chain unwinds to the current depth — which keeps repeated
    // but acyclic references (a DAG) intact, unlike a plain "seen" set.
    const ancestors: unknown[] = [];

    return function (this: unknown, _key: string, value: unknown): unknown {
        const depth = ancestors.indexOf(this);
        if (depth === -1) ancestors.push(this);
        else ancestors.length = depth + 1;

        if (typeof value === 'bigint') return `${value}n`;
        if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;

        if (typeof value === 'object' && value !== null) {
            if (ancestors.includes(value)) return '[Circular]';
            if (value instanceof Error) return errorText(value);
            // Push the original before converting, so a self-referencing
            // Map/Set is caught on the way back round.
            if (value instanceof Map) {
                ancestors.push(value);
                return Object.fromEntries(value);
            }
            if (value instanceof Set) {
                ancestors.push(value);
                return [...value];
            }
        }

        return value;
    };
}

/** Last resort: name the thing, rather than a useless `[object Object]`. */
function label(value: unknown): string {
    const name = (value as { constructor?: { name?: string } } | null)?.constructor?.name;
    return `[${name ?? 'object'}]`;
}

/** Normalize array-or-CSV tags: trim, drop empties, de-dupe, clamp to 50 chars. */
export function normalizeTags(tags: TagsInput | undefined): string[] {
    const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [];

    const clean: string[] = [];
    for (const raw of list) {
        const tag = String(raw).trim().slice(0, MAX_TAG_LENGTH);
        if (tag !== '' && !clean.includes(tag)) clean.push(tag);
    }
    return clean;
}

/**
 * Build the request body for one report. The severity/priority come from the
 * method name (never from user input), `environment`/`release`/`defaultTags`
 * are folded into the tags, and the auto-captured call site (when available)
 * is attached as `file_name`/`line_number`.
 */
export function buildPayload(
    severity: Severity,
    priority: Priority,
    title: string,
    description: unknown,
    tags: TagsInput | undefined,
    config: Pick<ResolvedConfig, 'environment' | 'release' | 'defaultTags'>,
    location?: SourceLocation,
): ReportPayload {
    const baseTags: string[] = [...config.defaultTags];
    if (config.environment) baseTags.push(`env:${config.environment}`);
    if (config.release) baseTags.push(`release:${config.release}`);

    const payload: ReportPayload = {
        severity,
        priority,
        title: String(title).slice(0, MAX_TITLE_LENGTH),
        tags: normalizeTags([...baseTags, ...normalizeTags(tags)]),
    };

    const text = describe(description);
    if (text !== undefined) payload.description = text;

    if (location) {
        payload.file_name = location.file;
        payload.line_number = location.line;
    }

    return payload;
}
