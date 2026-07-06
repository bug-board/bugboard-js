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

/** Tags accept an array (`['ui', 'android']`) or a CSV string (`'ui,android'`). */
export type TagsInput = readonly string[] | string;

/**
 * One reporting call: `method(title, description?, tags?)`.
 *
 * - `title` — required; clamped to 255 characters.
 * - `description` — a string or a caught `Error` (message + stack are extracted).
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
}

/**
 * Client configuration. Provide **either** `apiKey` (publishable key, bearer
 * auth — browsers/mobile) **or** `keyId` + `signingSecret` (secret key, HMAC
 * auth — servers). The SDK picks the auth scheme from which is set.
 */
export interface BugBoardConfig {
    /** Publishable key (`bb_pub_…`) sent as a bearer token. Browser/mobile only. */
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
     * Override the ingestion endpoint.
     *
     * @internal For SDK tests only — production clients always target BugBoard.
     */
    endpoint?: string;
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
