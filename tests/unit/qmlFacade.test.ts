import assert from "node:assert/strict";
import { test } from "node:test";
import {
    accounts,
    activeAccount,
    addAccount,
    configFromPluginData,
    createStore,
    deleteAccount,
    elapsed,
    todayTotal,
    updateActiveAccount,
    weekTotal
} from "../../src/qml/index.ts";
import { createXhrTransport } from "../../src/qml/xhrTransport.ts";
import { createClockifyFake, FAKE_API_KEY } from "../fakes/clockifyFake.ts";

const HOUR = 3_600_000;
const NOON = Date.UTC(2024, 4, 15, 12);

test("configFromPluginData migrates the single-account layout", () => {
    assert.deepEqual(configFromPluginData({}), {
        accountId: "default",
        providerId: "clockify",
        settings: { apiKey: "", baseUrl: "https://api.clockify.me/api/v1" },
        workspaceId: "",
        defaultProjectId: "",
        defaultTaskId: "",
        defaultBillable: false,
        historyDays: 14,
        weekStart: 1
    });
    const legacy = configFromPluginData({
        provider: "clockify",
        "clockify.apiKey": "secret",
        "clockify.baseUrl": "",
        workspaceId: "ws-2",
        defaultProjectId: "p",
        defaultBillable: "true",
        historyDays: "30",
        weekStart: 0
    });
    assert.equal(legacy.settings.apiKey, "secret");
    assert.equal(legacy.settings.baseUrl, "https://api.clockify.me/api/v1", "empty value falls back to default");
    assert.equal(legacy.workspaceId, "ws-2");
    assert.equal(legacy.defaultProjectId, "p");
    assert.equal(legacy.defaultBillable, true);
    assert.equal(legacy.historyDays, 30);
    assert.equal(legacy.weekStart, 0);
    assert.equal(configFromPluginData(null).providerId, "clockify");
});

test("configFromPluginData uses the active account", () => {
    const data = {
        accounts: [
            { id: "a", name: "Personal", provider: "clockify", settings: { apiKey: "k1" }, workspaceId: "w1", defaultBillable: false },
            { id: "b", name: "Work", provider: "clockify", settings: { apiKey: "k2" }, workspaceId: "w2", defaultBillable: true }
        ],
        activeAccount: "b",
        // Legacy keys are ignored once accounts exist.
        "clockify.apiKey": "legacy"
    };
    const config = configFromPluginData(data);
    assert.equal(config.accountId, "b");
    assert.equal(config.settings.apiKey, "k2");
    assert.equal(config.workspaceId, "w2");
    assert.equal(config.defaultBillable, true);
    assert.equal(configFromPluginData({ ...data, activeAccount: "gone" }).accountId, "a", "unknown active id falls back to the first");
});

test("account mutations return the list to save", () => {
    const legacy = { "clockify.apiKey": "k1", defaultBillable: true };
    assert.deepEqual(
        accounts(legacy).map(a => [a.id, a.name, a.settings.apiKey]),
        [["default", "Clockify", "k1"]]
    );

    const added = addAccount(legacy, "clockify", 1000);
    assert.deepEqual(
        added.accounts.map(a => a.name),
        ["Clockify", "Clockify 2"]
    );
    const data = { accounts: added.accounts, activeAccount: added.id };
    assert.equal(activeAccount(data).name, "Clockify 2");

    const renamed = updateActiveAccount(data, { name: "Work", settings: { apiKey: "k2" } });
    assert.deepEqual(
        renamed.map(a => [a.name, a.settings.apiKey]),
        [
            ["Clockify", "k1"],
            ["Work", "k2"]
        ]
    );

    const removed = deleteAccount({ accounts: renamed, activeAccount: added.id }, added.id);
    assert.deepEqual(
        removed.accounts.map(a => a.id),
        ["default"]
    );
    assert.equal(removed.activeId, "default");
    assert.equal(deleteAccount({ accounts: removed.accounts }, "default").accounts.length, 1, "the last account stays");
});

test("live totals include the running timer", async () => {
    const fake = createClockifyFake();
    fake.seed({ start: NOON - 3 * HOUR, end: NOON - 2 * HOUR });
    fake.seed({ start: NOON - 30 * 60_000, end: null });
    const store = createStore({ transport: fake.transport, now: () => NOON });
    await store.configure(configFromPluginData({ "clockify.apiKey": FAKE_API_KEY }));
    const s = store.state;
    assert.equal(elapsed(s, NOON), 1800);
    assert.equal(todayTotal(s, NOON), 3600 + 1800);
    assert.equal(weekTotal(s, NOON), 3600 + 1800);
    assert.equal(elapsed({ ...s, running: null }, NOON), 0);
});

class FakeXhr {
    static last: FakeXhr | null = null;
    readyState = 0;
    status = 0;
    responseText = "";
    timeout = 0;
    onreadystatechange: (() => void) | null = null;
    opened: [string, string] | null = null;
    headers: Record<string, string> = {};
    sent: string | undefined = undefined;
    constructor() {
        FakeXhr.last = this;
    }
    open(method: string, url: string) {
        this.opened = [method, url];
    }
    setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
    }
    send(body?: string) {
        this.sent = body;
    }
    respond(status: number, text: string) {
        this.status = status;
        this.responseText = text;
        this.readyState = 4;
        this.onreadystatechange?.();
    }
}

test("XHR transport sends the request and resolves on DONE", async () => {
    const transport = createXhrTransport(() => new FakeXhr());
    const pending = transport({ method: "PUT", url: "http://x/y", headers: { A: "1" }, body: "{}" });
    const xhr = FakeXhr.last as FakeXhr;
    assert.deepEqual(xhr.opened, ["PUT", "http://x/y"]);
    assert.deepEqual(xhr.headers, { A: "1" });
    assert.equal(xhr.sent, "{}");
    assert.equal(xhr.timeout, 20_000);
    xhr.respond(200, "ok");
    xhr.respond(500, "ignored second callback");
    assert.deepEqual(await pending, { status: 200, body: "ok" });
});

test("XHR transport turns exceptions into status 0", async () => {
    const transport = createXhrTransport(() => {
        throw new Error("no XHR");
    });
    assert.deepEqual(await transport({ method: "GET", url: "u", headers: {}, body: null }), { status: 0, body: "Error: no XHR" });
});
