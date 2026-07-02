/**
 * Error classes mirroring the API's error → exception mapping.
 *
 * Reporting is fire-and-forget, so these are never thrown into the host app —
 * they are surfaced through the SDK's debug logger. They exist so the log
 * output (and any future callback API) carries structured failure detail.
 */

/** Base class for every SDK error. */
export class BugBoardError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = new.target.name;
    }
}

/** 401 (bad key, bad signature, expired timestamp) or 403 (origin not allowed). */
export class BugBoardAuthError extends BugBoardError {}

/** 422 — the payload failed validation. Carries the per-field error map. */
export class BugBoardValidationError extends BugBoardError {
    constructor(
        message: string,
        readonly fieldErrors: Record<string, string[]> = {},
    ) {
        super(message);
    }
}

/** 429 — the per-minute burst limit was exceeded. Carries the Retry-After hint. */
export class BugBoardRateLimitError extends BugBoardError {
    constructor(
        message: string,
        readonly retryAfter?: number,
    ) {
        super(message);
    }
}

/** 5xx or a network/timeout failure. */
export class BugBoardServerError extends BugBoardError {}
