import assert from "node:assert/strict";
import { test } from "node:test";
import { withRetry } from "../../src/core/retry.ts";
import type { HttpRequest, HttpResponse } from "../../src/core/types.ts";

const request: HttpRequest = { method: "GET", url: "http://x/y", headers: {}, body: null };

function scripted(statuses: number[]) {
    const calls: number[] = [];
    const transport = (): Promise<HttpResponse> => {
        const status = statuses[calls.length] ?? 200;
        calls.push(status);
        return Promise.resolve({ status, body: String(status) });
    };
    return { calls, transport };
}

test("retries 429 with exponential back-off", async () => {
    const { calls, transport } = scripted([429, 429, 200]);
    const waits: number[] = [];
    const wrapped = withRetry(transport, {
        delay: ms => {
            waits.push(ms);
            return Promise.resolve();
        }
    });
    assert.deepEqual(await wrapped(request), { status: 200, body: "200" });
    assert.deepEqual(calls, [429, 429, 200]);
    assert.deepEqual(waits, [500, 1000]);
});

test("gives up after the configured retries", async () => {
    const { calls, transport } = scripted([429, 429, 429, 429, 429]);
    const wrapped = withRetry(transport, { delay: () => Promise.resolve(), retries: 2 });
    assert.equal((await wrapped(request)).status, 429);
    assert.equal(calls.length, 3);
});

test("does not retry without a delay function or for other errors", async () => {
    assert.equal((await withRetry(scripted([429]).transport)(request)).status, 429);
    const other = scripted([500, 200]);
    assert.equal((await withRetry(other.transport, { delay: () => Promise.resolve() })(request)).status, 500);
    assert.equal(other.calls.length, 1);
});

test("limits concurrency and releases slots on failure", async () => {
    let active = 0;
    let peak = 0;
    const pending: (() => void)[] = [];
    const transport = (): Promise<HttpResponse> =>
        new Promise((resolve, reject) => {
            active++;
            peak = Math.max(peak, active);
            pending.push(() => {
                active--;
                if (pending.length % 2) reject(new Error("boom"));
                else resolve({ status: 200, body: "" });
            });
        });
    const wrapped = withRetry(transport, { maxConcurrent: 2 });
    const all = Promise.allSettled(Array.from({ length: 6 }, () => wrapped(request)));
    // Drain: finish whatever is in flight until every request ran.
    for (let i = 0; i < 6; i++) {
        await new Promise(r => setImmediate(r));
        pending.shift()?.();
    }
    const results = await all;
    assert.equal(peak, 2);
    assert.equal(results.length, 6);
    assert.ok(results.some(r => r.status === "rejected"));
});
