import type { BugBoardConfig, ReportPayload } from './types';

/** BugBoard's ingestion origin. */
export const DEFAULT_BASE_URL = 'https://bugboard.dev';

/** The ingestion route, appended to the base URL. Also the signed request path. */
export const API_PATH = '/api/v1/tasks';

/** Resolved configuration with every default applied. */
export interface ResolvedConfig {
    auth:
        | { scheme: 'bearer'; apiKey: string }
        | { scheme: 'hmac'; keyId: string; signingSecret: string }
        | { scheme: 'none' };
    encryptionPublicKey?: string;
    encryptionKeyId?: string;
    enabled: boolean;
    captureLocation: boolean;
    environment?: string;
    release?: string;
    defaultTags: readonly string[];
    sampleRate: number;
    maxQueueSize: number;
    concurrency: number;
    flushIntervalMs: number;
    timeoutMs: number;
    maxRetries: number;
    beforeSend?: (payload: ReportPayload) => ReportPayload | null;
    debug: boolean;
    logLocally: boolean;
    endpoint: string;
}

const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

const positiveInt = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 1
        ? Math.floor(value)
        : fallback;

const nonNegativeInt = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : fallback;

/**
 * Build the full ingestion URL from a base URL, keeping only its origin so a
 * trailing slash or a stray path prefix can't change the route we sign.
 *
 * An unparseable base URL falls back to BugBoard rather than throwing — a bad
 * option must never take down the app the SDK is monitoring.
 */
function resolveEndpoint(baseUrl: string | undefined, warnings: string[]): string {
    if (!baseUrl?.trim()) return DEFAULT_BASE_URL + API_PATH;

    let origin: string | undefined;
    try {
        origin = new URL(baseUrl).origin;
    } catch {
        origin = undefined;
    }

    // Non-special schemes (e.g. `localhost:8000`, parsed as scheme `localhost:`)
    // have no origin and serialize to the string 'null'.
    if (!origin || origin === 'null') {
        warnings.push(
            `baseUrl ${JSON.stringify(baseUrl)} is not an absolute URL — falling back to ${DEFAULT_BASE_URL}.`,
        );
        return DEFAULT_BASE_URL + API_PATH;
    }

    return origin + API_PATH;
}

/**
 * Apply defaults and pick the auth scheme from which credentials are set.
 *
 * Invalid setups (no credentials at all) resolve to a disabled client rather
 * than throwing — the SDK must never crash the app it monitors. Problems are
 * reported as `warnings` for the caller to log.
 */
export function resolveConfig(config: BugBoardConfig): {
    resolved: ResolvedConfig;
    warnings: string[];
} {
    const warnings: string[] = [];

    let auth: ResolvedConfig['auth'] = { scheme: 'none' };
    const hasSecretKey = Boolean(config.keyId && config.signingSecret);
    if (hasSecretKey) {
        auth = { scheme: 'hmac', keyId: config.keyId!, signingSecret: config.signingSecret! };
        if (config.apiKey) {
            warnings.push(
                'Both a publishable key and a secret key are configured; using the secret key (HMAC).',
            );
        }
    } else if (config.apiKey) {
        auth = { scheme: 'bearer', apiKey: config.apiKey };
        if (config.keyId || config.signingSecret) {
            warnings.push(
                'A secret key needs both keyId and signingSecret; falling back to the publishable key.',
            );
        }
    }

    let enabled = config.enabled ?? true;
    if (enabled && auth.scheme === 'none') {
        warnings.push(
            'No credentials configured (set apiKey, or keyId + signingSecret) — reporting is disabled.',
        );
        enabled = false;
    }

    let sampleRate = config.sampleRate ?? 1;
    if (typeof sampleRate !== 'number' || Number.isNaN(sampleRate)) sampleRate = 1;
    sampleRate = clamp(sampleRate, 0, 1);

    return {
        resolved: {
            auth,
            encryptionPublicKey: config.encryptionPublicKey || undefined,
            encryptionKeyId: config.encryptionKeyId || undefined,
            enabled,
            captureLocation: config.captureLocation ?? true,
            environment: config.environment || undefined,
            release: config.release || undefined,
            defaultTags: config.defaultTags ?? [],
            sampleRate,
            maxQueueSize: positiveInt(config.maxQueueSize, 100),
            concurrency: positiveInt(config.concurrency, 3),
            flushIntervalMs: positiveInt(config.flushIntervalMs, 2000),
            timeoutMs: positiveInt(config.timeoutMs, 5000),
            maxRetries: nonNegativeInt(config.maxRetries, 3),
            beforeSend: config.beforeSend,
            debug: config.debug ?? false,
            logLocally: config.logLocally ?? false,
            endpoint: resolveEndpoint(config.baseUrl, warnings),
        },
        warnings,
    };
}
