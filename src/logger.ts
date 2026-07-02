/**
 * Internal debug logger.
 *
 * Silent unless `debug: true` — a monitoring SDK must never spam the console
 * of the app it watches. Secrets are redacted from every message so a debug
 * session can never leak a key into logs.
 */

export interface Logger {
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

const PREFIX = '[bugboard]';

/** Key material patterns — redacted wherever they appear in log output. */
const SECRET_PATTERNS = [/bb_sec_[A-Za-z0-9]+/g, /bb_pub_[A-Za-z0-9]+/g];

export function createLogger(debug: boolean, secrets: readonly (string | undefined)[]): Logger {
    const knownSecrets = secrets.filter((value): value is string => Boolean(value));

    const redact = (arg: unknown): unknown => {
        if (typeof arg !== 'string') return arg;
        let text = arg;
        for (const secret of knownSecrets) text = text.split(secret).join('[redacted]');
        for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
        return text;
    };

    if (!debug) {
        const noop = () => undefined;
        return { debug: noop, warn: noop, error: noop };
    }

    return {
        debug: (...args) => console.debug(PREFIX, ...args.map(redact)),
        warn: (...args) => console.warn(PREFIX, ...args.map(redact)),
        error: (...args) => console.error(PREFIX, ...args.map(redact)),
    };
}
