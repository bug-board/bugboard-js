import type { ResolvedConfig } from './config';
import { API_PATH } from './config';
import { sealBody } from './encryption';
import {
    BugBoardAuthError,
    BugBoardError,
    BugBoardRateLimitError,
    BugBoardServerError,
    BugBoardValidationError,
} from './errors';
import type { Logger } from './logger';
import type { QuotaGate } from './quota';
import { readDropReason } from './quota';
import type { ReportPayload } from './types';
import { bearerHeaders, signedHeaders } from './signer';

export interface SendOptions {
    /**
     * Best-effort mode for shutdown flushes: `keepalive` lets the browser
     * finish the request after the page unloads, and retries are skipped
     * because there is no time left to back off.
     */
    keepalive?: boolean;
}

export interface Transport {
    /** Deliver one report. Resolves on success or drop; rejects with a BugBoardError. */
    send(payload: ReportPayload, options?: SendOptions): Promise<void>;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** Exponential backoff with equal jitter, so bursts don't retry in lockstep. */
function backoffDelay(attempt: number, retryAfterSeconds?: number): number {
    if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
        return retryAfterSeconds * 1000;
    }
    const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    return exponential / 2 + Math.random() * (exponential / 2);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(response: Response): number | undefined {
    const header = response.headers.get('Retry-After');
    if (header === null) return undefined;
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
    try {
        return (await response.json()) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/** Map a failed response to the SDK error taxonomy (API reference §6). */
async function toError(response: Response): Promise<BugBoardError> {
    const body = await parseJson(response);
    const message = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;

    if (response.status === 401 || response.status === 403) {
        return new BugBoardAuthError(message);
    }
    if (response.status === 422) {
        const errors = (body.errors ?? {}) as Record<string, string[]>;
        return new BugBoardValidationError(message, errors);
    }
    if (response.status === 429) {
        return new BugBoardRateLimitError(message, parseRetryAfter(response));
    }
    return new BugBoardServerError(message);
}

/** Only 429, 5xx, and network failures are retried; other 4xx are config/payload bugs. */
function isRetryable(error: BugBoardError): boolean {
    return error instanceof BugBoardRateLimitError || error instanceof BugBoardServerError;
}

export function createTransport(
    config: ResolvedConfig,
    logger: Logger,
    quota: QuotaGate,
): Transport {
    /**
     * Serialize (and optionally encrypt) the body once per report; the same
     * bytes are transmitted on every attempt. Auth is applied per attempt so
     * HMAC timestamps stay within the server's ±300 s window.
     */
    async function prepareBody(payload: ReportPayload): Promise<string> {
        const body = JSON.stringify(payload);
        if (!config.encryptionPublicKey) return body;
        // Encrypt first, then sign: the signature covers the envelope bytes.
        return sealBody(body, config.encryptionPublicKey, config.encryptionKeyId);
    }

    async function authHeaders(body: string): Promise<Record<string, string>> {
        if (config.auth.scheme === 'bearer') return bearerHeaders(config.auth.apiKey);
        if (config.auth.scheme === 'hmac') {
            return signedHeaders(
                config.auth.keyId,
                config.auth.signingSecret,
                'POST',
                API_PATH,
                body,
            );
        }
        return {};
    }

    async function attemptOnce(body: string, options: SendOptions): Promise<void> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        // In Node, don't let a pending timeout hold the process open.
        (timeout as { unref?: () => void }).unref?.();

        let response: Response;
        try {
            response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    // A header, not a body field: it stays readable when the body is
                    // encrypted, and out of reach of `beforeSend` (§5). It is not
                    // covered by the HMAC signature, which spans the body only.
                    ...(config.hideApiResponse ? { 'X-Bb-Hide-Response': 'true' } : {}),
                    ...(await authHeaders(body)),
                },
                body,
                signal: controller.signal,
                ...(options.keepalive ? { keepalive: true } : {}),
            });
        } catch (cause) {
            throw new BugBoardServerError('Network error while reporting to BugBoard', { cause });
        } finally {
            clearTimeout(timeout);
        }

        if (response.ok) {
            const data = await parseJson(response);
            const dropped = readDropReason(data);
            if (dropped !== undefined) {
                // Not an error: the server accepted the report and discarded it.
                // Never retried (§6) — and the gate stops us sending the next one
                // at all, since it would meet the same fate.
                quota.arm(dropped);
            } else if (data.deduplicated === true) {
                logger.debug('Report deduplicated into an existing card.');
            } else {
                logger.debug('Report delivered.');
            }
            return;
        }

        throw await toError(response);
    }

    return {
        async send(payload, options = {}) {
            // Dry-run mode: log the readable payload locally instead of sending it.
            if (config.logLocally) {
                logger.log('Report (log-only, not sent):', JSON.stringify(payload, null, 2));
                return;
            }

            // The server is discarding everything it receives right now, so this
            // report would cost a round trip and be thrown away at the far end.
            if (quota.shouldDiscard()) return;

            const body = await prepareBody(payload);
            const maxRetries = options.keepalive ? 0 : config.maxRetries;

            for (let attempt = 0; ; attempt++) {
                try {
                    await attemptOnce(body, options);
                    return;
                } catch (error) {
                    const bugboardError =
                        error instanceof BugBoardError
                            ? error
                            : new BugBoardServerError(String(error), { cause: error });

                    if (!isRetryable(bugboardError) || attempt >= maxRetries) {
                        throw bugboardError;
                    }

                    const retryAfter =
                        bugboardError instanceof BugBoardRateLimitError
                            ? bugboardError.retryAfter
                            : undefined;
                    const delay = backoffDelay(attempt, retryAfter);
                    logger.debug(
                        `Attempt ${attempt + 1} failed (${bugboardError.message}); retrying in ${Math.round(delay)}ms.`,
                    );
                    await sleep(delay);
                }
            }
        },
    };
}
