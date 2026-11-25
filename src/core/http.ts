import { type ErrorKind, type HttpRequest, type HttpResponse, TrackerError, type Transport } from "./types.ts";

export type Query = Record<string, string | number | boolean | null | undefined>;

export function trimSlashes(url: string): string {
    return url.trim().replace(/\/+$/, "");
}

export function encodeQuery(query: Query | undefined): string {
    if (!query) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
}

/** Encodes one path segment. */
export function seg(value: string): string {
    return encodeURIComponent(value);
}

export function kindForStatus(status: number): ErrorKind {
    if (status === 0) return "network";
    if (status === 401 || status === 403) return "auth";
    if (status === 404) return "not-found";
    if (status === 400 || status === 422) return "validation";
    if (status === 429) return "rate-limit";
    if (status >= 500) return "server";
    return "unknown";
}

const FALLBACK_MESSAGES: Partial<Record<ErrorKind, string>> = {
    network: "Network error: the service is unreachable",
    auth: "Authentication failed: check the API key",
    "not-found": "Not found",
    "rate-limit": "Too many requests, try again later",
    server: "The service returned a server error"
};

/** Builds a TrackerError from a failed response, preferring the service's own message. */
export function httpError(status: number, body: string, extractMessage: (json: unknown) => string = defaultMessage): TrackerError {
    const kind = kindForStatus(status);
    let message = "";
    try {
        message = extractMessage(JSON.parse(body));
    } catch {
        message = "";
    }
    if (!message) message = FALLBACK_MESSAGES[kind] ?? (body.trim().slice(0, 200) || `Request failed (HTTP ${status})`);
    return new TrackerError(kind, message, status);
}

function defaultMessage(json: unknown): string {
    if (json && typeof json === "object") {
        const record = json as Record<string, unknown>;
        for (const key of ["message", "error", "error_description"]) {
            const value = record[key];
            if (typeof value === "string" && value) return value;
        }
    }
    return "";
}

export interface JsonClientOptions {
    baseUrl: string;
    headers: Record<string, string>;
    transport: Transport;
    extractMessage?: (json: unknown) => string;
}

/** Minimal JSON-over-HTTP client bound to one base URL. */
export class JsonClient {
    readonly baseUrl: string;
    private readonly headers: Record<string, string>;
    private readonly transport: Transport;
    private readonly extractMessage: ((json: unknown) => string) | undefined;

    constructor(options: JsonClientOptions) {
        this.baseUrl = trimSlashes(options.baseUrl);
        this.headers = options.headers;
        this.transport = options.transport;
        this.extractMessage = options.extractMessage;
    }

    url(path: string, query?: Query): string {
        return this.baseUrl + path + encodeQuery(query);
    }

    // Promise chains, not async/await: see docs/ARCHITECTURE.md ("QML engine constraints").
    request<T>(method: HttpRequest["method"], path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
        const headers: Record<string, string> = { Accept: "application/json", ...this.headers };
        let body: string | null = null;
        if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(options.body);
        }
        const request: HttpRequest = { method, url: this.url(path, options.query), headers, body };
        return Promise.resolve()
            .then(() => this.transport(request))
            .then(
                response => this.parse<T>(response),
                (error: unknown) => {
                    throw new TrackerError("network", `Network error: ${error instanceof Error ? error.message : String(error)}`);
                }
            );
    }

    private parse<T>(response: HttpResponse): T {
        const text = response.body ?? "";
        if (response.status < 200 || response.status >= 300) throw httpError(response.status, text, this.extractMessage);
        if (text.trim() === "") return null as T;
        try {
            return JSON.parse(text) as T;
        } catch {
            throw new TrackerError("server", "Malformed response from the service", response.status);
        }
    }

    get<T>(path: string, query?: Query): Promise<T> {
        return this.request<T>("GET", path, query ? { query } : {});
    }
}
