import type { HttpRequest, HttpResponse, Transport } from "../core/types.ts";

/** Subset of XMLHttpRequest available in the QML JavaScript engine. */
interface QmlXhr {
    readyState: number;
    status: number;
    responseText: string;
    timeout?: number;
    onreadystatechange: (() => void) | null;
    open(method: string, url: string, async: boolean): void;
    setRequestHeader(name: string, value: string): void;
    send(body?: string): void;
}

// Global of the QML engine. Referenced directly: V4 ES modules have no `globalThis`.
declare const XMLHttpRequest: new () => QmlXhr;

const DONE = 4;
export const TIMEOUT_MS = 20_000;

/**
 * Transport backed by the QML engine's XMLHttpRequest. Network failures resolve
 * with status 0 (never reject) so the API layer reports them uniformly.
 */
export function createXhrTransport(factory?: () => QmlXhr): Transport {
    const make = factory ?? (() => new XMLHttpRequest());
    return (request: HttpRequest) =>
        new Promise<HttpResponse>(resolve => {
            let settled = false;
            const finish = (status: number, body: string) => {
                if (settled) return;
                settled = true;
                resolve({ status, body });
            };
            try {
                const xhr = make();
                xhr.onreadystatechange = () => {
                    if (xhr.readyState === DONE) finish(xhr.status, xhr.responseText ?? "");
                };
                xhr.open(request.method, request.url, true);
                for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
                if ("timeout" in xhr) xhr.timeout = TIMEOUT_MS;
                if (request.body !== null) xhr.send(request.body);
                else xhr.send();
            } catch (error) {
                finish(0, String(error));
            }
        });
}
