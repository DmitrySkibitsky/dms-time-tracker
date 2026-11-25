// Clockify-specific behaviour not covered by the provider contract: wire mapping,
// request shapes, pagination and workspace rules.

import assert from "node:assert/strict";
import { test } from "node:test";
import { TrackerError } from "../../src/core/types.ts";
import { CLOCKIFY_DEFAULT_URL, ClockifyProvider, clockifyDescriptor, PAGE_SIZE } from "../../src/providers/clockify/provider.ts";
import { toEntryBody, toTimeEntry, toWorkspace } from "../../src/providers/clockify/wire.ts";
import { createClockifyFake, FAKE_API_KEY } from "../fakes/clockifyFake.ts";

function setup() {
    const fake = createClockifyFake();
    const provider = new ClockifyProvider({ settings: { apiKey: FAKE_API_KEY }, transport: fake.transport });
    return { fake, provider };
}

test("requires an API key", () => {
    assert.throws(
        () => new ClockifyProvider({ settings: { apiKey: "  " }, transport: async () => ({ status: 200, body: "" }) }),
        (e: unknown) => e instanceof TrackerError && e.kind === "config"
    );
});

test("uses the default URL unless overridden and sends the API key", async () => {
    const urls: string[] = [];
    const transport = async (req: { url: string; headers: Record<string, string> }) => {
        urls.push(req.url);
        assert.equal(req.headers["X-Api-Key"], "k");
        return { status: 200, body: '{"id":"u"}' };
    };
    await new ClockifyProvider({ settings: { apiKey: "k" }, transport }).getUser();
    await new ClockifyProvider({ settings: { apiKey: "k", baseUrl: "https://eu.example/api/v1/" }, transport }).getUser();
    assert.deepEqual(urls, [`${CLOCKIFY_DEFAULT_URL}/user`, "https://eu.example/api/v1/user"]);
});

test("caches the user and retries after a failure", async () => {
    const { fake, provider } = setup();
    fake.state.failNext = { status: 500, message: "boom" };
    await assert.rejects(provider.getUser());
    await provider.getUser();
    await provider.getUser();
    assert.equal(fake.state.requests.filter(r => r.path === "/user").length, 2);
});

test("maps hydrated entries and workspace rules", () => {
    const entry = toTimeEntry({
        id: "e",
        description: null,
        projectId: "p",
        tagIds: ["a", "b"],
        timeInterval: { start: "2024-05-15T09:00:00Z", end: null },
        project: { name: "Proj", color: "#123" },
        task: { name: "Task" },
        tags: [{ id: "b", name: "Bee" }]
    });
    assert.deepEqual(entry, {
        id: "e",
        description: "",
        projectId: "p",
        taskId: null,
        tagIds: ["a", "b"],
        billable: false,
        start: Date.UTC(2024, 4, 15, 9),
        end: null,
        projectName: "Proj",
        projectColor: "#123",
        taskName: "Task",
        tagNames: ["", "Bee"]
    });
    assert.throws(() => toTimeEntry({ id: "bad", timeInterval: {} }));
    assert.deepEqual(toWorkspace({ id: "w", workspaceSettings: { forceProjects: true, forceTags: true } }).requirements, {
        project: true,
        task: false,
        description: false,
        tags: true
    });
});

test("entry bodies omit end for running timers", () => {
    const input = {
        description: "d",
        projectId: null,
        taskId: null,
        tagIds: ["t"],
        billable: true,
        start: Date.UTC(2024, 0, 1, 9),
        end: null
    };
    assert.deepEqual(toEntryBody(input), {
        start: "2024-01-01T09:00:00Z",
        description: "d",
        projectId: null,
        taskId: null,
        tagIds: ["t"],
        billable: true
    });
    assert.equal(toEntryBody({ ...input, end: Date.UTC(2024, 0, 1, 10) }).end, "2024-01-01T10:00:00Z");
});

test("uses the documented endpoints", async () => {
    const { fake, provider } = setup();
    await provider.getRunning("ws-1");
    await provider.listEntries("ws-1", { from: Date.UTC(2024, 0, 1), to: Date.UTC(2024, 0, 2) });
    const [, running, list] = fake.state.requests;
    assert.equal(running?.path, "/workspaces/ws-1/user/user-1/time-entries");
    assert.equal(running?.query["in-progress"], "true");
    assert.equal(list?.query.start, "2024-01-01T00:00:00Z");
    assert.equal(list?.query.end, "2024-01-02T00:00:00Z");
    assert.equal(list?.query.hydrated, "true");
});

test("paginates list endpoints", async () => {
    const { fake, provider } = setup();
    fake.state.tags["ws-1"] = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ id: `t${i}`, name: `tag ${i}`, archived: false }));
    const tags = await provider.listTags("ws-1");
    assert.equal(tags.length, PAGE_SIZE + 5);
    assert.deepEqual(
        fake.state.requests.filter(r => r.path.endsWith("/tags")).map(r => r.query.page),
        ["1", "2"]
    );
});

test("archived projects are excluded; tasks carry their project", async () => {
    const { provider } = setup();
    const projects = await provider.listProjects("ws-1");
    assert.ok(!projects.some(p => p.id === "p-old"));
    const tasks = await provider.listTasks("ws-1", "p-web");
    assert.ok(tasks.every(t => t.projectId === "p-web"));
});

test("rejects mismatched start/create calls", async () => {
    const { provider } = setup();
    const input = { description: "", projectId: null, taskId: null, tagIds: [], billable: false, start: 0, end: 1000 };
    await assert.rejects(provider.startTimer("ws-1", input), { kind: "validation" });
    await assert.rejects(provider.createEntry("ws-1", { ...input, end: null }), { kind: "validation" });
});

test("descriptor exposes settings for the settings screen", () => {
    assert.deepEqual(
        clockifyDescriptor.settings.map(s => [s.key, s.kind, s.required]),
        [
            ["apiKey", "secret", true],
            ["baseUrl", "url", false]
        ]
    );
});
