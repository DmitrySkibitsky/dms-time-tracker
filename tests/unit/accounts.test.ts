import assert from "node:assert/strict";
import { test } from "node:test";
import {
    type Account,
    activeAccountId,
    findActiveAccount,
    listAccounts,
    newAccount,
    patchAccount,
    removeAccount,
    withSettingDefaults
} from "../../src/core/accounts.ts";
import { toArray } from "../../src/core/arrays.ts";
import { clockifyDescriptor } from "../../src/providers/clockify/provider.ts";

const ctx = { providers: [clockifyDescriptor], defaultProvider: "clockify" };

function account(id: string, extra: Partial<Account> = {}): Account {
    return {
        id,
        name: id,
        provider: "clockify",
        settings: {},
        workspaceId: "",
        defaultProjectId: "",
        defaultTaskId: "",
        defaultBillable: false,
        ...extra
    };
}

test("listAccounts sanitises stored accounts", () => {
    const list = listAccounts(
        {
            accounts: [
                { id: "a", name: "A", provider: "clockify", settings: { apiKey: "k", junk: 5 }, defaultBillable: "true" },
                { id: "a", name: "duplicate id" },
                { name: "no id", provider: "unknown-service" },
                "garbage",
                null
            ]
        },
        ctx
    );
    assert.deepEqual(
        list.map(a => [a.id, a.name, a.provider]),
        [
            ["a", "A", "clockify"],
            ["account-3", "no id", "clockify"]
        ]
    );
    assert.deepEqual(list[0]?.settings, { apiKey: "k" }, "non-string settings dropped");
    assert.equal(list[0]?.defaultBillable, true);
});

test("accepts array-like account lists (QML sequences)", () => {
    const sequence = { length: 1, 0: { id: "q", name: "From QML", provider: "clockify" } };
    assert.deepEqual(
        listAccounts({ accounts: sequence }, ctx).map(a => a.id),
        ["q"]
    );
    assert.deepEqual(toArray("nope"), []);
    assert.deepEqual(toArray(null), []);
});

test("legacy settings become one account", () => {
    const [legacy] = listAccounts({ "clockify.apiKey": "k", "clockify.baseUrl": "https://eu/api", workspaceId: "w" }, ctx);
    assert.equal(legacy?.id, "default");
    assert.equal(legacy?.name, "Clockify");
    assert.deepEqual(legacy?.settings, { apiKey: "k", baseUrl: "https://eu/api" });
    assert.equal(legacy?.workspaceId, "w");
    assert.equal(listAccounts(null, ctx).length, 1, "always at least one account");
});

test("active account falls back to the first", () => {
    const data = { accounts: [account("a"), account("b")], activeAccount: "b" };
    assert.equal(activeAccountId(data, listAccounts(data, ctx)), "b");
    assert.equal(findActiveAccount({ ...data, activeAccount: "x" }, ctx).id, "a");
});

test("patchAccount merges settings and resets workspace data on a service change", () => {
    const list = [account("a", { settings: { apiKey: "k", baseUrl: "u" }, workspaceId: "w", defaultProjectId: "p" }), account("b")];
    const renamed = patchAccount(list, "a", { name: "Work", settings: { apiKey: "k2" } });
    assert.deepEqual(renamed[0]?.settings, { apiKey: "k2", baseUrl: "u" });
    assert.equal(renamed[0]?.name, "Work");
    assert.equal(renamed[0]?.workspaceId, "w");
    assert.equal(renamed[1], list[1], "other accounts untouched");

    const moved = patchAccount(list, "a", { provider: "toggl" });
    assert.deepEqual(moved[0]?.settings, {});
    assert.equal(moved[0]?.workspaceId, "");
    assert.equal(moved[0]?.defaultProjectId, "");
    assert.equal(patchAccount(list, "a", { id: "hijack" } as never)[0]?.id, "a", "ids are immutable");
});

test("newAccount picks unique names and ids", () => {
    const first = newAccount([], clockifyDescriptor, 1000);
    assert.equal(first.name, "Clockify");
    const second = newAccount([first], clockifyDescriptor, 1000);
    assert.equal(second.name, "Clockify 2");
    assert.notEqual(second.id, first.id);
    const third = newAccount([first, { ...second, name: "Clockify 3" }], clockifyDescriptor, 2000);
    assert.equal(third.name, "Clockify 4");
    assert.deepEqual(
        removeAccount([first, second], first.id).map(a => a.id),
        [second.id]
    );
});

test("withSettingDefaults fills empty fields from the descriptor", () => {
    assert.deepEqual(withSettingDefaults({ apiKey: "k", baseUrl: "" }, clockifyDescriptor), {
        apiKey: "k",
        baseUrl: "https://api.clockify.me/api/v1"
    });
    assert.deepEqual(withSettingDefaults({ x: "1" }, null), { x: "1" });
});
