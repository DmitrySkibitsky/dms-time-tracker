import assert from "node:assert/strict";
import { test } from "node:test";
import * as E from "../../src/core/entries.ts";
import type { Capabilities, Project, TimeEntry } from "../../src/core/types.ts";

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

const caps: Capabilities = {
    workspaces: true,
    projects: true,
    tasks: true,
    tags: true,
    billable: true,
    projectColors: true,
    requiresProject: false,
    requiresTask: false,
    editRunningEntry: true
};

const projects: Project[] = [
    { id: "p2", name: "beta", clientName: "", color: "", billable: false, archived: false },
    { id: "p1", name: "Alpha", clientName: "Zeta Corp", color: "#111", billable: true, archived: false },
    { id: "p3", name: "Gamma", clientName: "Acme", color: "", billable: false, archived: false },
    { id: "p4", name: "Old", clientName: "", color: "", billable: false, archived: true }
];

function entry(id: string, start: number, end: number | null, extra: Partial<TimeEntry> = {}): TimeEntry {
    return { id, description: "", projectId: null, taskId: null, tagIds: [], billable: false, start, end, ...extra };
}

const emptyLookups: E.Lookups = { projects: new Map(), tasks: new Map(), tags: new Map() };

test("toView resolves labels from lookups, falling back to provider hints", () => {
    const lookups: E.Lookups = {
        projects: E.indexById(projects),
        tasks: new Map([["t1", { id: "t1", name: "Docs", projectId: "p1" }]]),
        tags: new Map([["g1", { id: "g1", name: "writing" }]])
    };
    const view = E.toView(
        entry("e1", 0, 3600_000, { projectId: "p1", taskId: "t1", tagIds: ["g1", "g2"], tagNames: ["x", "ops"] }),
        lookups,
        0
    );
    assert.equal(view.projectName, "Alpha");
    assert.equal(view.projectColor, "#111");
    assert.equal(view.clientName, "Zeta Corp");
    assert.equal(view.taskName, "Docs");
    assert.deepEqual(view.tagNames, ["writing", "ops"]);
    assert.equal(view.duration, 3600);
    assert.equal(view.running, false);

    const archived = E.toView(
        entry("e2", 0, null, { projectId: "gone", projectName: "Archived", projectColor: "#abc" }),
        emptyLookups,
        90_000
    );
    assert.equal(archived.projectName, "Archived");
    assert.equal(archived.projectColor, "#abc");
    assert.equal(archived.running, true);
    assert.equal(archived.duration, 90);
});

test("totalBetween clips intervals and counts running to now", () => {
    const now = local(2024, 5, 15, 12);
    const list = [
        entry("a", local(2024, 5, 14, 23), local(2024, 5, 15, 1)),
        entry("b", local(2024, 5, 15, 9), local(2024, 5, 15, 10)),
        entry("c", local(2024, 5, 15, 11), null)
    ];
    assert.equal(E.totalBetween(list, local(2024, 5, 15), local(2024, 5, 16), now), 3 * 3600);
    assert.equal(E.totalBetween(list, local(2024, 5, 14), local(2024, 5, 15), now), 3600);
    assert.equal(E.entrySeconds(entry("x", 1000, 500), 0), 0, "never negative");
});

test("groupByDay groups newest first with totals", () => {
    const now = local(2024, 5, 15, 12);
    const views = [
        entry("old", local(2024, 5, 13, 9), local(2024, 5, 13, 9, 30)),
        entry("t1", local(2024, 5, 15, 8), local(2024, 5, 15, 9)),
        entry("y1", local(2024, 5, 14, 9), local(2024, 5, 14, 11)),
        entry("t2", local(2024, 5, 15, 10), local(2024, 5, 15, 10, 15))
    ].map(e => E.toView(e, emptyLookups, now));
    const groups = E.groupByDay(views, now);
    assert.deepEqual(
        groups.map(g => g.key),
        ["2024-05-15", "2024-05-14", "2024-05-13"]
    );
    assert.deepEqual(
        groups.map(g => g.daysAgo),
        [0, 1, 2]
    );
    assert.deepEqual(
        groups.map(g => g.total),
        [4500, 7200, 1800]
    );
    assert.deepEqual(
        groups[0]?.entries.map(e => e.id),
        ["t2", "t1"]
    );
});

test("upsert/removeById", () => {
    let list = [entry("a", 100, 200), entry("b", 300, 400)];
    list = E.upsert(list, entry("c", 200, 250));
    assert.deepEqual(
        list.map(e => e.id),
        ["b", "c", "a"]
    );
    list = E.upsert(list, entry("a", 500, 600));
    assert.deepEqual(
        list.map(e => e.id),
        ["a", "b", "c"]
    );
    assert.deepEqual(
        E.removeById(list, "b").map(e => e.id),
        ["a", "c"]
    );
});

test("drafts: defaults, copies and patches", () => {
    assert.deepEqual(E.emptyDraft({ projectId: "p1", taskId: "t1" }), {
        description: "",
        projectId: "p1",
        taskId: "t1",
        tagIds: [],
        billable: false,
        start: null,
        end: null
    });
    assert.equal(E.emptyDraft({ taskId: "t1" }).taskId, null, "no task without a project");

    const src = entry("x", 1000, 2000, { description: "Fix", projectId: "p1", taskId: "t1", tagIds: ["g"], billable: true });
    const draft = E.draftFromEntry(src);
    draft.tagIds.push("mutated");
    assert.deepEqual(src.tagIds, ["g"], "draft must not alias entry arrays");

    assert.equal(E.applyPatch(E.draftFromEntry(src), { projectId: "p2" }).taskId, null);
    assert.equal(E.applyPatch(E.draftFromEntry(src), { projectId: "p1", description: "New" }).taskId, "t1");
    assert.equal(E.applyPatch(E.draftFromEntry(src), { projectId: "p2", taskId: "t9" }).taskId, "t9");
    assert.equal(E.applyPatch(E.draftFromEntry(src), { projectId: "" }).projectId, null, "empty string normalises to null");
});

test("effectiveRequirements merges capabilities and workspace rules", () => {
    const ws = { requirements: { project: true, task: false, description: true, tags: true } };
    assert.deepEqual(E.effectiveRequirements(caps, ws), { project: true, task: false, description: true, tags: true });
    assert.deepEqual(E.effectiveRequirements({ ...caps, tags: false, requiresTask: true }, null), {
        project: false,
        task: true,
        description: false,
        tags: false
    });
    assert.equal(E.effectiveRequirements({ ...caps, projects: false }, ws).project, false, "unsupported fields are never required");
});

test("validateDraft", () => {
    const none = E.NO_REQUIREMENTS;
    const base = { ...E.emptyDraft(), start: 1000, end: 2000 };
    assert.equal(E.validateDraft(base, none, { requireEnd: true }), "");
    assert.equal(E.validateDraft({ ...base, start: null }, none), "missing-start");
    assert.equal(E.validateDraft({ ...base, end: null }, none, { requireEnd: true }), "missing-end");
    assert.equal(E.validateDraft({ ...base, end: null }, none), "");
    assert.equal(E.validateDraft({ ...base, end: 500 }, none), "end-before-start");
    assert.equal(E.validateDraft(base, { ...none, project: true }), "missing-project");
    assert.equal(E.validateDraft({ ...base, projectId: "p" }, { ...none, project: true, task: true }), "missing-task");
    assert.equal(E.validateDraft({ ...base, description: "  " }, { ...none, description: true }), "missing-description");
    assert.equal(E.validateDraft(base, { ...none, tags: true }), "missing-tags");
});

test("toInput trims and drops unsupported fields", () => {
    const draft = { description: "  Work ", projectId: "p", taskId: "t", tagIds: ["g"], billable: true, start: 1000, end: null };
    assert.deepEqual(E.toInput(draft, caps), { ...draft, description: "Work" });
    assert.deepEqual(E.toInput(draft, { ...caps, tasks: false, tags: false, billable: false }), {
        description: "Work",
        projectId: "p",
        taskId: null,
        tagIds: [],
        billable: false,
        start: 1000,
        end: null
    });
    assert.equal(E.toInput({ ...draft, projectId: null }, caps).taskId, null, "task requires a project");
    assert.throws(() => E.toInput({ ...draft, start: null }, caps));
});

test("project and task options", () => {
    assert.deepEqual(
        E.sortProjects(projects).map(p => p.id),
        ["p2", "p3", "p1"]
    );
    assert.equal(E.projectLabel(projects[1]), "Alpha · Zeta Corp");
    assert.equal(E.projectLabel(projects[0]), "beta");
    assert.equal(E.projectLabel(null), "");
    assert.deepEqual(E.projectOptions(projects, "None"), {
        labels: ["None", "beta", "Gamma · Acme", "Alpha · Zeta Corp"],
        values: ["", "p2", "p3", "p1"]
    });
    assert.deepEqual(
        E.taskOptions(
            [
                { id: "b", name: "beta", projectId: "p" },
                { id: "a", name: "Alpha", projectId: "p" }
            ],
            "-"
        ),
        { labels: ["-", "Alpha", "beta"], values: ["", "a", "b"] }
    );
});

test("recentSuggestions de-duplicates and filters", () => {
    const views = [
        entry("1", 100, 200, { description: "Standup", projectId: "p1", projectName: "Alpha" }),
        entry("2", 300, 400, { description: "Standup", projectId: "p1", projectName: "Alpha" }),
        entry("3", 500, 600, { description: "Standup", projectId: "p2", projectName: "Beta" }),
        entry("4", 700, 800, { description: "Code review", projectId: "p1", projectName: "Alpha" }),
        entry("5", 900, 1000)
    ].map(e => E.toView(e, emptyLookups, 0));
    assert.deepEqual(
        E.recentSuggestions(views, "").map(e => e.id),
        ["4", "3", "2"]
    );
    assert.deepEqual(
        E.recentSuggestions(views, "stand").map(e => e.id),
        ["3", "2"]
    );
    assert.deepEqual(
        E.recentSuggestions(views, "beta").map(e => e.id),
        ["3"]
    );
    assert.deepEqual(
        E.recentSuggestions(views, "", 1).map(e => e.id),
        ["4"]
    );
});
