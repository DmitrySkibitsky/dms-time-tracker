// Behaviour every TrackerProvider must have. Each adapter runs this suite against its own
// fake service (see clockify.contract.test.ts); a new provider gets coverage by adding a harness.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type ProviderDescriptor, TrackerError, type TrackerProvider } from "../../src/core/types.ts";

export interface SeedEntry {
    description?: string;
    projectId?: string | null;
    start: number;
    end: number | null;
}

export interface ContractHarness {
    provider: TrackerProvider;
    /** Provider built with invalid credentials. */
    unauthorized: TrackerProvider;
    workspaceId: string;
    /** A project id that exists in workspaceId. */
    projectId: string;
    /** Inserts an entry directly into the fake service; returns its id. */
    seed(entry: SeedEntry): string;
    /** Makes the next request fail at network level. */
    goOffline(): void;
}

const HOUR = 3_600_000;
const BASE = Date.UTC(2024, 4, 15, 9);

export function runProviderContract(descriptor: ProviderDescriptor, makeHarness: () => ContractHarness): void {
    describe(`provider contract: ${descriptor.id}`, () => {
        test("descriptor is well formed", () => {
            assert.match(descriptor.id, /^[a-z][a-z0-9-]*$/);
            assert.ok(descriptor.name);
            assert.ok(descriptor.settings.length > 0);
            const keys = descriptor.settings.map(s => s.key);
            assert.equal(new Set(keys).size, keys.length, "setting keys are unique");
            assert.ok(
                descriptor.settings.some(s => s.required),
                "at least one required setting (credentials)"
            );
        });

        test("identifies the user and lists workspaces", async () => {
            const h = makeHarness();
            const user = await h.provider.getUser();
            assert.ok(user.id);
            const workspaces = await h.provider.listWorkspaces();
            assert.ok(workspaces.some(w => w.id === h.workspaceId));
            for (const w of workspaces) assert.equal(typeof w.requirements.project, "boolean");
        });

        test("lists catalogues", async () => {
            const h = makeHarness();
            const projects = await h.provider.listProjects(h.workspaceId);
            assert.ok(projects.some(p => p.id === h.projectId));
            assert.ok(projects.every(p => typeof p.name === "string" && typeof p.archived === "boolean"));
            if (h.provider.capabilities.tags) assert.ok(Array.isArray(await h.provider.listTags(h.workspaceId)));
            if (h.provider.capabilities.tasks) assert.ok(Array.isArray(await h.provider.listTasks(h.workspaceId, h.projectId)));
        });

        test("timer lifecycle: start, read running, edit, stop", async () => {
            const h = makeHarness();
            const p = h.provider;
            assert.equal(await p.getRunning(h.workspaceId), null);

            const started = await p.startTimer(h.workspaceId, {
                description: "Contract",
                projectId: h.projectId,
                taskId: null,
                tagIds: [],
                billable: false,
                start: BASE,
                end: null
            });
            assert.equal(started.end, null);
            assert.equal(started.start, BASE);
            assert.equal(started.description, "Contract");

            const running = await p.getRunning(h.workspaceId);
            assert.equal(running?.id, started.id);

            const edited = await p.updateEntry(h.workspaceId, started.id, {
                description: "Edited",
                projectId: null,
                taskId: null,
                tagIds: [],
                billable: false,
                start: BASE - HOUR,
                end: null
            });
            assert.equal(edited.end, null, "running entry stays running after edit");
            assert.equal(edited.start, BASE - HOUR);
            assert.equal(edited.projectId, null);

            const stopped = await p.stopTimer(h.workspaceId, edited, BASE + HOUR);
            assert.equal(stopped.id, started.id);
            assert.equal(stopped.end, BASE + HOUR);
            assert.equal(await p.getRunning(h.workspaceId), null);
        });

        test("manual entries: create, list by range, update, delete", async () => {
            const h = makeHarness();
            const p = h.provider;
            const outside = h.seed({ description: "old", start: BASE - 48 * HOUR, end: BASE - 47 * HOUR });
            const created = await p.createEntry(h.workspaceId, {
                description: "Manual",
                projectId: h.projectId,
                taskId: null,
                tagIds: [],
                billable: true,
                start: BASE,
                end: BASE + 2 * HOUR
            });
            assert.equal(created.end, BASE + 2 * HOUR);

            const listed = await p.listEntries(h.workspaceId, { from: BASE - HOUR, to: BASE + 24 * HOUR });
            assert.ok(listed.some(e => e.id === created.id));
            assert.ok(!listed.some(e => e.id === outside), "range filter applies");

            const updated = await p.updateEntry(h.workspaceId, created.id, {
                description: "Manual edited",
                projectId: h.projectId,
                taskId: null,
                tagIds: [],
                billable: false,
                start: BASE,
                end: BASE + HOUR
            });
            assert.equal(updated.description, "Manual edited");
            assert.equal(updated.end, BASE + HOUR);

            await p.deleteEntry(h.workspaceId, created.id);
            const after = await p.listEntries(h.workspaceId, { from: BASE - HOUR, to: BASE + 24 * HOUR });
            assert.ok(!after.some(e => e.id === created.id));
        });

        test("errors are TrackerErrors with a kind", async () => {
            const h = makeHarness();
            await assert.rejects(h.unauthorized.getUser(), (e: unknown) => e instanceof TrackerError && e.kind === "auth");
            await assert.rejects(
                h.provider.deleteEntry(h.workspaceId, "missing"),
                (e: unknown) => e instanceof TrackerError && e.kind === "not-found"
            );
            h.goOffline();
            await assert.rejects(h.provider.listWorkspaces(), (e: unknown) => e instanceof TrackerError && e.kind === "network");
        });
    });
}
