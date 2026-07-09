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

/**
 * Turn the `description` argument into text: strings pass through, `Error`s
 * contribute their message + stack, anything else is stringified.
 */
function describe(description: unknown): string | undefined {
    if (description === null || description === undefined) return undefined;

    let text: string;
    if (description instanceof Error) {
        const stack = description.stack ?? '';
        // V8 stacks begin with "name: message" — avoid repeating the message.
        text = stack.includes(description.message)
            ? stack
            : `${description.message}\n${stack}`.trim();
    } else {
        text = typeof description === 'string' ? description : stringify(description);
    }

    text = text.trim();
    if (text === '') return undefined;
    return text.slice(0, MAX_DESCRIPTION_LENGTH);
}

function stringify(value: unknown): string {
    if (typeof value !== 'object' || value === null) return String(value);
    try {
        return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
        return Object.prototype.toString.call(value);
    }
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
