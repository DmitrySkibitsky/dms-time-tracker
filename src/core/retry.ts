import type { HttpRequest, HttpResponse, Transport } from "./types.ts";

/** Resolves after `ms` milliseconds. Supplied by the host: the QML engine has no setTimeout. */
export type Delay = (ms: number) => Promise<void>;

export interface RetryOptions {
    /** Without a delay function 429 responses are returned as is (no retries). */
    delay?: Delay | undefined;
    /** Retries after a 429 response. */
    retries?: number;
    /** First back-off; doubles on every retry. */
    baseDelayMs?: number;
    /** Requests in flight at once; the rest wait in a FIFO queue. */
    maxConcurrent?: number;
}

/**
 * Wraps a transport so bursts (a full reload, quick account switches) stay under the service's
 * rate limit: at most `maxConcurrent` requests run at once, and "429 Too Many Requests" is
 * retried with exponential back-off.
 */
export function withRetry(inner: Transport, options: RetryOptions = {}): Transport {
    const retries = options.retries ?? 3;
    const baseDelay = options.baseDelayMs ?? 500;
    const maxConcurrent = Math.max(1, options.maxConcurrent ?? 4);
    const delay = options.delay;
    let active = 0;
    const waiting: (() => void)[] = [];

    const acquire = (): Promise<void> =>
        new Promise(resolve => {
            if (active < maxConcurrent) {
                active++;
                resolve();
            } else {
                waiting.push(() => {
                    active++;
                    resolve();
                });
            }
        });

    const release = (): void => {
        active--;
        const next = waiting.shift();
        if (next) next();
    };

    const attempt = (request: HttpRequest, n: number): Promise<HttpResponse> =>
        inner(request).then(response => {
            if (response.status === 429 && delay && n < retries) return delay(baseDelay * 2 ** n).then(() => attempt(request, n + 1));
            return response;
        });

    return request =>
        acquire()
            .then(() => attempt(request, 0))
            .then(
                response => {
                    release();
                    return response;
                },
                (error: unknown) => {
                    release();
                    throw error;
                }
            );
}
