import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDraft } from "../../src/core/entries.ts";
import { CATALOGUE_TTL_MS, liveTotal, type ResultCode, type StoreState, TrackerStore } from "../../src/core/store.ts";
import { providers } from "../../src/providers/registry.ts";
import { createClockifyFake, FAKE_API_KEY } from "../fakes/clockifyFake.ts";

const HOUR = 3_600_000;
const MIN = 60_000;
// Wednesday 2024-05-15 12:00 UTC (tests run with TZ=UTC).
const NOON = Date.UTC(2024, 4, 15, 12);

function setup(options: { apiKey?: string; workspaceId?: string; defaultProjectId?: string } = {}) {
    const fake = createClockifyFake();
    let now = NOON;
    const changes: StoreState[] = [];
    const errors: { message: string; code: ResultCode }[] = [];
    const store = new TrackerStore({
        providers,
        transport: fake.transport,
        now: () => now,
        onChange: s => changes.push(s),
        onError: (message, code) => errors.push({ message, code })
    });
    const configure = () =>
        store.configure({
            providerId: "clockify",
            settings: { apiKey: options.apiKey ?? FAKE_API_KEY },
            workspaceId: options.workspaceId ?? "",
            defaultProjectId: options.defaultProjectId ?? ""
        });
    return {
        fake,
        store,
        changes,
        errors,
        configure,
        advance: (ms: number) => {
            now += ms;
        },
        get now() {
            return now;
        }
    };
}

test("is unconfigured without credentials", async () => {
    const t = setup({ apiKey: "" });
    const result = await t.configure();
    assert.equal(result.ok, false);
    assert.equal(t.store.state.status, "unconfigured");
    assert.equal(t.fake.state.requests.length, 0);
});

test("unknown provider is an error", async () => {
    const t = setup();
    const result = await t.store.configure({ providerId: "nope", settings: {} });
    assert.equal(result.ok, false);
    assert.equal(t.store.state.status, "error");
    assert.match(t.store.state.error, /Unknown provider/);
});

test("loads user, workspace, catalogues, running timer and history", async () => {
    const t = setup();
    t.fake.seed({ description: "Yesterday", projectId: "p-web", start: NOON - 26 * HOUR, end: NOON - 25 * HOUR });
    t.fake.seed({ description: "Morning", projectId: "p-int", start: NOON - 3 * HOUR, end: NOON - 2 * HOUR });
    t.fake.seed({ description: "Ancient", start: NOON - 40 * 24 * HOUR, end: NOON - 40 * 24 * HOUR + HOUR });
    t.fake.seed({ description: "Now", start: NOON - 30 * MIN, end: null });

    const result = await t.configure();
    assert.deepEqual(result, { ok: true, code: "", error: "" });
    const s = t.store.state;
    assert.equal(s.status, "ready");
    assert.equal(s.providerName, "Clockify");
    assert.equal(s.user?.name, "Test User");
    assert.equal(s.workspaceId, "ws-1");
    assert.equal(s.workspaceName, "Main");
    assert.deepEqual(
        s.projects.map(p => p.id),
        ["p-int", "p-web"],
        "archived dropped, client sort"
    );
    assert.deepEqual(
        s.tags.map(x => x.name),
        ["meeting", "review"]
    );
    assert.equal(s.running?.description, "Now");
    assert.deepEqual(
        s.entries.map(e => e.description),
        ["Morning", "Yesterday"],
        "running and out-of-range entries excluded"
    );
    assert.equal(s.entries[0]?.projectName, "Internal");
    assert.deepEqual(
        s.days.map(d => d.daysAgo),
        [0, 1]
    );
    assert.equal(s.todayFinished, 3600);
    assert.equal(liveTotal(s, s.todayFinished, s.dayStart, s.dayStart + 24 * HOUR, t.now), 3600 + 1800);
    assert.equal(s.weekFinished, 7200);
    assert.equal(s.lastSync, NOON);
});

test("honours the preferred workspace and its rules", async () => {
    const t = setup({ workspaceId: "ws-2" });
    await t.configure();
    assert.equal(t.store.state.workspaceId, "ws-2");
    assert.equal(t.store.state.requirements.project, true);

    const result = await t.store.start({ description: "No project" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "missing-project");
    assert.equal(t.errors.at(-1)?.code, "missing-project");
    assert.equal(t.store.state.running, null);
});

test("a default project from another workspace is ignored", async () => {
    const t = setup({ workspaceId: "ws-2", defaultProjectId: "p-web" });
    await t.configure();
    assert.equal(t.store.state.draft.projectId, null);
    await t.store.configure({ workspaceId: "ws-1" });
    assert.equal(t.store.state.draft.projectId, "p-web");
});

test("falls back to the user's workspace when the preferred one is gone", async () => {
    const t = setup({ workspaceId: "ws-deleted" });
    await t.configure();
    assert.equal(t.store.state.workspaceId, "ws-1");
});

test("start, edit and stop a timer", async () => {
    const t = setup({ defaultProjectId: "p-web" });
    await t.configure();
    assert.equal(t.store.state.draft.projectId, "p-web", "draft starts with the default project");

    t.store.setDraft({ description: "Feature X" });
    const started = await t.store.start();
    assert.ok(started.ok);
    let s = t.store.state;
    assert.equal(s.running?.description, "Feature X");
    assert.equal(s.running?.projectName, "Website");
    assert.equal(s.running?.start, NOON);
    assert.equal(s.draft.description, "", "draft resets after start");
    assert.equal(s.draft.projectId, "p-web");

    t.advance(10 * MIN);
    assert.ok((await t.store.updateRunning({ description: "Feature X (review)", tagIds: ["tag-rev"] })).ok);
    assert.equal(t.store.state.running?.description, "Feature X (review)");
    assert.deepEqual(t.store.state.running?.tagNames, ["review"]);

    assert.ok((await t.store.updateRunning({ start: NOON - 20 * MIN })).ok);
    assert.equal(t.store.state.running?.start, NOON - 20 * MIN);

    const future = await t.store.updateRunning({ start: t.now + HOUR });
    assert.equal(future.code, "start-in-future");

    t.advance(20 * MIN);
    assert.ok((await t.store.stop()).ok);
    s = t.store.state;
    assert.equal(s.running, null);
    assert.equal(s.entries[0]?.description, "Feature X (review)");
    assert.equal(s.entries[0]?.duration, 50 * 60);
    assert.equal(s.todayFinished, 50 * 60);
    assert.equal(t.fake.state.entries[0]?.end, t.now);
});

test("new timers use the remembered billable flag", async () => {
    const t = setup();
    await t.configure();
    assert.equal(t.store.state.draft.billable, false);
    await t.store.configure({ defaultBillable: true });
    assert.equal(t.store.state.draft.billable, true);
    await t.store.start({ description: "Client work" });
    assert.equal(t.store.state.running?.billable, true);
    assert.equal(t.fake.state.entries[0]?.billable, true);
    assert.equal(t.store.state.draft.billable, true, "the reset draft keeps the default");
    assert.equal(emptyDraft({ billable: true }).billable, true);
});

test("starting while running stops the previous timer first", async () => {
    const t = setup();
    await t.configure();
    await t.store.start({ description: "First" });
    t.advance(15 * MIN);
    await t.store.start({ description: "Second" });
    const s = t.store.state;
    assert.equal(s.running?.description, "Second");
    assert.equal(s.entries[0]?.description, "First");
    assert.equal(s.entries[0]?.duration, 15 * 60);
    assert.ok(
        t.fake.state.requests.some(r => r.method === "PATCH"),
        "explicit stop request"
    );
});

test("toggle starts and stops", async () => {
    const t = setup();
    await t.configure();
    await t.store.toggle();
    assert.ok(t.store.state.running);
    t.advance(MIN);
    await t.store.toggle();
    assert.equal(t.store.state.running, null);
    assert.equal(t.store.state.entries.length, 1);
});

test("stop without a running timer fails gracefully", async () => {
    const t = setup();
    await t.configure();
    const r = await t.store.stop();
    assert.equal(r.code, "not-running");
});

test("manual entry, edit, duplicate, continue and delete", async () => {
    const t = setup();
    await t.configure();

    const draft = { ...emptyDraft(), description: "Meeting", projectId: "p-int", start: NOON - 2 * HOUR, end: NOON - HOUR };
    assert.ok((await t.store.createEntry(draft)).ok);
    let entry = t.store.state.entries[0];
    assert.equal(entry?.description, "Meeting");

    const invalid = await t.store.createEntry({ ...draft, end: null });
    assert.equal(invalid.code, "missing-end");

    assert.ok((await t.store.updateEntry(entry?.id ?? "", { ...draft, description: "Planning", end: NOON - 90 * MIN })).ok);
    entry = t.store.state.entries[0];
    assert.equal(entry?.description, "Planning");
    assert.equal(entry?.duration, 30 * 60);

    assert.ok((await t.store.duplicateEntry(entry?.id ?? "")).ok);
    assert.equal(t.store.state.entries.length, 2);

    assert.ok((await t.store.continueEntry(entry?.id ?? "")).ok);
    assert.equal(t.store.state.running?.description, "Planning");
    assert.equal(t.store.state.running?.projectId, "p-int");
    assert.equal(t.store.state.running?.start, t.now);

    assert.ok((await t.store.deleteEntry(entry?.id ?? "")).ok);
    assert.equal(t.store.state.entries.length, 1);

    assert.ok((await t.store.deleteEntry(t.store.state.running?.id ?? "")).ok, "discarding the running timer");
    assert.equal(t.store.state.running, null);

    assert.equal((await t.store.deleteEntry("missing")).code, "not-found");
    assert.equal((await t.store.continueEntry("missing")).code, "not-found");
});

test("entries outside the history window are not added locally", async () => {
    const t = setup();
    await t.configure();
    await t.store.createEntry({ ...emptyDraft(), start: NOON - 60 * 24 * HOUR, end: NOON - 60 * 24 * HOUR + HOUR });
    assert.equal(t.store.state.entries.length, 0);
    assert.equal(t.fake.state.entries.length, 1);
});

test("refresh picks up changes made elsewhere", async () => {
    const t = setup();
    await t.configure();
    t.fake.seed({ description: "From web app", start: NOON - 5 * MIN, end: null });
    t.advance(MIN);
    assert.ok((await t.store.refresh()).ok);
    assert.equal(t.store.state.running?.description, "From web app");
    assert.equal(t.store.state.lastSync, t.now);
});

test("unchanged refreshes don't emit; a new day does", async () => {
    const t = setup();
    t.fake.seed({ description: "Stable", start: NOON - 2 * HOUR, end: NOON - HOUR });
    await t.configure();
    const emitted = t.changes.length;
    await t.store.refresh();
    assert.equal(t.changes.length, emitted);
    t.advance(13 * HOUR); // past midnight
    await t.store.refresh();
    assert.equal(t.changes.length, emitted + 1);
    assert.equal(t.store.state.days[0]?.daysAgo, 1);
    assert.equal(t.store.state.todayFinished, 0);
});

test("refresh failure keeps data and recovers", async () => {
    const t = setup();
    t.fake.seed({ description: "Kept", start: NOON - 2 * HOUR, end: NOON - HOUR });
    await t.configure();
    t.fake.state.offline = true;
    const r = await t.store.refresh();
    assert.equal(r.code, "network");
    assert.equal(t.store.state.status, "ready");
    assert.equal(t.store.state.entries.length, 1, "cached data kept");
    assert.ok(t.store.state.error);
    t.fake.state.offline = false;
    await t.store.refresh();
    assert.equal(t.store.state.error, "");
});

test("load failure shows an error and refresh retries the full load", async () => {
    const t = setup({ apiKey: "bad" });
    const r = await t.configure();
    assert.equal(r.code, "auth");
    assert.equal(t.store.state.status, "error");
    assert.equal(t.errors.at(-1)?.code, "auth");

    t.fake.state.apiKey = "bad";
    assert.ok((await t.store.refresh()).ok);
    assert.equal(t.store.state.status, "ready");
});

test("mutations fail cleanly when the service rejects them", async () => {
    const t = setup();
    await t.configure();
    t.fake.state.failNext = { status: 400, message: "Project is archived" };
    const r = await t.store.start({ description: "x" });
    assert.deepEqual(r, { ok: false, code: "validation", error: "Project is archived" });
    assert.equal(t.store.state.running, null);
    assert.equal(t.store.state.pending, 0);
});

test("actions before the store is ready are rejected", async () => {
    const t = setup({ apiKey: "" });
    await t.configure();
    assert.equal((await t.store.start()).code, "not-ready");
    assert.equal((await t.store.refresh()).code, "not-ready");
});

test("stale loads are discarded when settings change mid-flight", async () => {
    const t = setup();
    const first = t.configure();
    const second = t.store.configure({ workspaceId: "ws-2" });
    await Promise.all([first, second]);
    assert.equal(t.store.state.workspaceId, "ws-2");
    assert.deepEqual(
        t.store.state.projects.map(p => p.id),
        ["p-side"]
    );
});

test("switching accounts reloads and resets the timer form", async () => {
    const t = setup();
    await t.store.configure({ accountId: "a", providerId: "clockify", settings: { apiKey: FAKE_API_KEY } });
    t.store.setDraft({ description: "typed for account a" });
    const before = t.fake.state.requests.length;
    await t.store.configure({ accountId: "b", providerId: "clockify", settings: { apiKey: FAKE_API_KEY } });
    assert.ok(t.fake.state.requests.length > before, "reloaded although credentials are equal");
    assert.equal(t.store.state.draft.description, "");
    assert.equal(t.store.state.status, "ready");
});

test("switching back to an account reuses its cached catalogues", async () => {
    const t = setup();
    const a = { accountId: "a", providerId: "clockify", settings: { apiKey: FAKE_API_KEY } };
    const b = { accountId: "b", providerId: "clockify", settings: { apiKey: FAKE_API_KEY } };
    await t.store.configure(a);
    await t.store.configure(b);
    const before = t.fake.state.requests.length;
    await t.store.configure(a);
    const paths = t.fake.state.requests.slice(before).map(r => r.path);
    assert.deepEqual(
        paths,
        ["/workspaces/ws-1/user/user-1/time-entries", "/workspaces/ws-1/user/user-1/time-entries"],
        "running + history only"
    );
    assert.equal(t.store.state.status, "ready");
    assert.deepEqual(
        t.store.state.projects.map(p => p.id),
        ["p-int", "p-web"]
    );
    assert.equal(t.store.state.user?.name, "Test User");

    const forced = t.fake.state.requests.length;
    await t.store.reload();
    assert.ok(
        t.fake.state.requests.slice(forced).some(r => r.path === "/workspaces"),
        "Reconnect refetches catalogues"
    );

    t.advance(CATALOGUE_TTL_MS + 1);
    await t.store.configure(b);
    const expired = t.fake.state.requests.length;
    await t.store.configure(a);
    assert.ok(
        t.fake.state.requests.slice(expired).some(r => r.path === "/workspaces"),
        "expired cache is refetched"
    );
});

test("changing only defaults does not reload", async () => {
    const t = setup();
    await t.configure();
    const before = t.fake.state.requests.length;
    await t.store.configure({ defaultProjectId: "p-int" });
    assert.equal(t.fake.state.requests.length, before + 1, "only the task list for the new default project");
    assert.equal(t.store.state.draft.projectId, "p-int");

    t.store.setDraft({ description: "typed" });
    await t.store.configure({ defaultProjectId: "p-web" });
    assert.equal(t.store.state.draft.projectId, "p-int", "a touched draft is kept");
});

test("tasks load lazily per project and are cached", async () => {
    const t = setup();
    await t.configure();
    t.store.setDraft({ projectId: "p-web" });
    const tasks = await t.store.loadTasks("p-web");
    assert.equal(tasks.length, 2);
    assert.deepEqual(
        t.store.state.tasks["p-web"]?.map(x => x.name),
        ["Design", "Development"]
    );
    await t.store.loadTasks("p-web");
    assert.equal(t.fake.state.requests.filter(r => r.path.endsWith("/tasks")).length, 1);
});

test("history length is configurable and clamped", async () => {
    const t = setup();
    t.fake.seed({ description: "Three days ago", start: NOON - 72 * HOUR, end: NOON - 71 * HOUR });
    await t.configure();
    assert.equal(t.store.state.entries.length, 1);
    await t.store.configure({ historyDays: 2 });
    assert.equal(t.store.state.entries.length, 0);
    await t.store.configure({ historyDays: 1000 });
    assert.equal(t.store.currentConfig.historyDays, 90);
});
