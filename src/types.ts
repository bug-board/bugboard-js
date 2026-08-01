/**
 * Shared types for the BugBoard SDK.
 *
 * The reporting surface is exactly 16 severity×priority methods, derived from
 * the severity and priority enums below. A bare severity name (`critical`) is
 * shorthand for the medium-priority variant (`criticalMedium`).
 */

export const SEVERITIES = ['critical', 'major', 'moderate', 'minor'] as const;

export type Severity = (typeof SEVERITIES)[number];

export type Priority = 'low' | 'medium' | 'high';

/** Method-name suffix → priority. The empty suffix is the medium default. */
export const PRIORITY_SUFFIXES = {
    '': 'medium',
    Low: 'low',
    Medium: 'medium',
    High: 'high',
} as const;

export type PrioritySuffix = keyof typeof PRIORITY_SUFFIXES;

/** The 16 reporting method names: `critical`, `criticalLow`, … `minorHigh`. */
export type ReportMethodName = `${Severity}${PrioritySuffix}`;

/** Tags accept an array (`['ui', 'checkout']`) or a CSV string (`'ui,checkout'`). */
export type TagsInput = readonly string[] | string;

/**
 * One reporting call: `method(title, description?, tags?)`.
 *
 * - `title` — required; clamped to 255 characters.
 * - `description` — anything. A caught `Error` contributes its message + stack;
 *   objects and arrays are pretty-printed as JSON; scalars are stringified.
 * - `tags` — an array or a CSV string; each tag is clamped to 50 characters.
 *
 * Reporting is fire-and-forget: the call returns immediately and never throws.
 */
export type ReportFn = (title: string, description?: unknown, tags?: TagsInput) => void;

/** The JSON body sent to `POST /api/v1/tasks`. */
export interface ReportPayload {
    severity: Severity;
    priority: Priority;
    title: string;
    description?: string;
    tags: string[];
    /**
     * File the report points at (auto-captured): the throw site when an error
     * was reported, the reporting call site otherwise.
     */
    file_name?: string;
    /**
     * Line within `file_name`. Omitted unless the `lineNumbers` option is
     * switched on — see its documentation for why.
     */
    line_number?: number;
}

/**
 * Client configuration. Provide **either** `apiKey` (publishable key, bearer
 * auth — client-side code) **or** `keyId` + `signingSecret` (secret key, HMAC
 * auth — servers). The SDK picks the auth scheme from which is set.
 */
export interface BugBoardConfig {
    /** Publishable key (`bb_pub_…`) sent as a bearer token. Client-side only. */
    apiKey?: string;
    /** Public key id (`bbk_…`) identifying which secret key signed the request. */
    keyId?: string;
    /** Signing secret (`bb_sec_…`). Used only to compute signatures; never transmitted. */
    signingSecret?: string;
    /** Project encryption public key (base64 X25519). When set, every payload is encrypted. */
    encryptionPublicKey?: string;
    /** Encryption key id (`bbek_…`) echoed in the envelope so the server picks the right key. */
    encryptionKeyId?: string;
    /** Master switch — set `false` to disable reporting entirely (e.g. in tests). */
    enabled?: boolean;
    /** Added to every card as tag `env:<value>`. */
    environment?: string;
    /** Added to every card as tag `release:<value>`. */
    release?: string;
    /** Tags merged into every card. */
    defaultTags?: readonly string[];
    /**
     * Auto-capture the source location each report points at (sent as
     * `file_name`, and as `line_number` if `lineNumbers` is on). Defaults to
     * `true`; set `false` to skip reading stacks entirely.
     *
     * When the description is an error, that is its throw site — read off the
     * error's own stack, so a report made from a global handler names the
     * failure rather than the handler. Otherwise it is the reporting call site.
     */
    captureLocation?: boolean;
    /**
     * Also report the line number, as `line_number`. Defaults to **`false`**:
     * the file name ships, the line does not.
     *
     * The file name is dependable everywhere. The line is not, and the two
     * fail differently. A bundled app with no build plugin gives the SDK a
     * stack full of frames that all name the same chunk — so the file is right
     * no matter which frame is picked, while the line is inferred from frame
     * depth and can point at the wrong statement. A helper of your own that
     * wraps a reporting method has the same effect: the location is the
     * wrapper's, and the line is the wrapper's line rather than yours.
     *
     * Switch this on once the line is actually derived rather than inferred —
     * that is, when a build plugin (`bugboard/vite` and friends) rewrites your
     * calls, which makes both fields exact, or on a Node server whose source
     * maps are being read. Off by default because a line number that is
     * *almost* right reads as authoritative and sends people to the wrong
     * place, which is worse than not showing one.
     */
    lineNumbers?: boolean;
    /**
     * Resolve bundled stack coordinates back to original files and lines using
     * source maps that already exist — nothing is ever uploaded.
     *
     * On **Node** this turns on the runtime's own support, which reads the
     * `.js.map` files sitting next to your server chunks. Defaults to `true`.
     * Note that it only affects modules loaded *afterwards*, so for full
     * coverage import `bugboard/preload` before your app code, or run with
     * `--enable-source-maps`.
     *
     * In the **browser** it makes the SDK fetch a chunk's `.js.map` when a
     * report is sent. Defaults to `false`, because it only works if you
     * actually deploy your maps — which publishes your source. Prefer the build
     * plugin (`bugboard/vite`), which needs no maps at all.
     */
    sourceMaps?: boolean;
    /** Probability (0–1) that a report is sent. Sample under load to stay within limits. */
    sampleRate?: number;
    /** Queue cap. Overflow drops the newest report (counted in debug output). */
    maxQueueSize?: number;
    /** Max parallel in-flight requests when draining the queue. */
    concurrency?: number;
    /** Background drain cadence in milliseconds. */
    flushIntervalMs?: number;
    /** Per-request timeout in milliseconds. */
    timeoutMs?: number;
    /** Retry attempts for 429/5xx/network failures. Other 4xx are never retried. */
    maxRetries?: number;
    /** Scrub PII or veto a report. Return the (mutated) payload, or `null` to drop it. */
    beforeSend?: (payload: ReportPayload) => ReportPayload | null;
    /** Verbose internal logging. Keys are always redacted. */
    debug?: boolean;
    /** When true, reports are logged locally instead of being sent. Useful for local debugging. */
    logLocally?: boolean;
    /**
     * Ask the server to leave the created card out of its response, so a report
     * isn't echoed back in plaintext where the network tab can read it. Defaults
     * to `true`; set `false` to receive the full response body.
     */
    hideApiResponse?: boolean;
    /**
     * Override the ingestion origin, e.g. `http://localhost:8000`. Only the
     * origin is used — the SDK appends `/api/v1/tasks` itself.
     *
     * @internal For SDK tests only — production clients always target BugBoard.
     */
    baseUrl?: string;
}

/**
 * A configured BugBoard client: the 16 reporting methods plus `flush()`.
 *
 * `flush()` drains the queue immediately — await it before a serverless
 * function or short-lived script exits. Long-lived apps never need it; the
 * SDK flushes in the background and on shutdown.
 */
export type BugBoardClient = {
    [K in ReportMethodName]: ReportFn;
} & {
    flush(): Promise<void>;
};
