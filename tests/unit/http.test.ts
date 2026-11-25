import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeQuery, httpError, JsonClient, kindForStatus } from "../../src/core/http.ts";
import { type HttpRequest, TrackerError } from "../../src/core/types.ts";

test("encodeQuery skips empty values and encodes", () => {
    assert.equal(encodeQuery(undefined), "");
    assert.equal(encodeQuery({ a: "x y", b: 2, c: "", d: null, e: undefined, f: true }), "?a=x%20y&b=2&f=true");
});

test("kindForStatus", () => {
    assert.equal(kindForStatus(0), "network");
    assert.equal(kindForStatus(401), "auth");
    assert.equal(kindForStatus(403), "auth");
    assert.equal(kindForStatus(404), "not-found");
    assert.equal(kindForStatus(400), "validation");
    assert.equal(kindForStatus(429), "rate-limit");
    assert.equal(kindForStatus(503), "server");
    assert.equal(kindForStatus(418), "unknown");
});

test("httpError prefers the service message", () => {
    const e = httpError(400, JSON.stringify({ message: "Project is required", code: 501 }));
    assert.ok(e instanceof TrackerError);
    assert.equal(e.kind, "validation");
    assert.equal(e.status, 400);
    assert.equal(e.message, "Project is required");
    assert.equal(httpError(401, "").message, "Authentication failed: check the API key");
    assert.equal(httpError(418, "teapot").message, "teapot");
    assert.equal(httpError(418, "").message, "Request failed (HTTP 418)");
});

test("JsonClient builds requests and parses responses", async () => {
    const seen: HttpRequest[] = [];
    const client = new JsonClient({
        baseUrl: "https://example.test/api/",
        headers: { "X-Api-Key": "k" },
        transport: async req => {
            seen.push(req);
            return { status: 200, body: '{"ok":true}' };
        }
    });
    assert.deepEqual(await client.request("POST", "/things", { query: { a: 1 }, body: { x: 1 } }), { ok: true });
    assert.deepEqual(seen[0], {
        method: "POST",
        url: "https://example.test/api/things?a=1",
        headers: { Accept: "application/json", "X-Api-Key": "k", "Content-Type": "application/json" },
        body: '{"x":1}'
    });
    await client.get("/plain");
    assert.equal(seen[1]?.body, null);
    assert.equal(seen[1]?.headers["Content-Type"], undefined);
});

test("JsonClient maps failures to TrackerError", async () => {
    const respond = (status: number, body: string) =>
        new JsonClient({ baseUrl: "http://x", headers: {}, transport: async () => ({ status, body }) });

    assert.equal(await respond(204, "").get("/empty"), null);
    await assert.rejects(respond(0, "").get("/"), { kind: "network" });
    await assert.rejects(respond(500, "oops").get("/"), { kind: "server" });
    await assert.rejects(respond(200, "{not json").get("/"), { kind: "server", message: "Malformed response from the service" });
    const throwing = new JsonClient({
        baseUrl: "http://x",
        headers: {},
        transport: () => Promise.reject(new Error("socket closed"))
    });
    await assert.rejects(throwing.get("/"), { kind: "network", message: "Network error: socket closed" });
});
