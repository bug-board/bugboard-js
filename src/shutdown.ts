/**
 * Graceful-shutdown flushing, so buffered reports aren't lost when the app
 * exits. The right hook depends on the runtime:
 *
 * - **Node** — `process.on('beforeExit')` runs when the event loop empties;
 *   scheduling the flush there keeps the process alive until delivery.
 * - **Browser** — `pagehide` is the last reliable moment before unload; the
 *   flush fires `keepalive` requests the browser completes after the page dies.
 * - **Edge/workers** — no process-wide hook exists; callers `await flush()`.
 */

interface FlushTarget {
    flush(): Promise<void>;
    flushSync(): void;
}

export function registerShutdownFlush(target: FlushTarget): void {
    const proc = (globalThis as { process?: NodeJS.Process }).process;
    if (proc && typeof proc.on === 'function' && proc.versions?.node) {
        proc.on('beforeExit', () => {
            void target.flush();
        });
        return;
    }

    if (typeof addEventListener === 'function' && typeof document !== 'undefined') {
        addEventListener('pagehide', () => {
            target.flushSync();
        });
    }
}
