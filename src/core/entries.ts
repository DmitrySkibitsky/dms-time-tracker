import { toArray } from "./arrays.ts";
import { dayKey, daysAgo, startOfDay } from "./time.ts";
import type { Capabilities, EntryDraft, EntryInput, Project, Requirements, Tag, Task, TimeEntry, Workspace } from "./types.ts";

/** Entry enriched with display labels; what the UI renders. */
export interface EntryView extends TimeEntry {
    projectName: string;
    projectColor: string;
    clientName: string;
    taskName: string;
    tagNames: string[];
    running: boolean;
    /** Seconds, counted up to "now" for the running entry. */
    duration: number;
}

export interface DayGroup {
    key: string;
    dayStart: number;
    daysAgo: number;
    total: number;
    entries: EntryView[];
}

export interface Lookups {
    projects: ReadonlyMap<string, Project>;
    tasks: ReadonlyMap<string, Task>;
    tags: ReadonlyMap<string, Tag>;
}

export type DraftError =
    | ""
    | "missing-start"
    | "missing-end"
    | "end-before-start"
    | "missing-project"
    | "missing-task"
    | "missing-description"
    | "missing-tags";

export function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
    return new Map(items.map(item => [item.id, item]));
}

export function entrySeconds(entry: Pick<TimeEntry, "start" | "end">, now: number): number {
    const end = entry.end ?? now;
    return Math.max(0, Math.round((end - entry.start) / 1000));
}

export function toView(entry: TimeEntry, lookups: Lookups, now: number): EntryView {
    const project = entry.projectId ? lookups.projects.get(entry.projectId) : undefined;
    const task = entry.taskId ? lookups.tasks.get(entry.taskId) : undefined;
    const tagNames = entry.tagIds.map((id, i) => lookups.tags.get(id)?.name ?? entry.tagNames?.[i] ?? "").filter(name => name !== "");
    return {
        ...entry,
        tagIds: [...entry.tagIds],
        projectName: project?.name ?? entry.projectName ?? "",
        projectColor: project?.color ?? entry.projectColor ?? "",
        clientName: project?.clientName ?? "",
        taskName: task?.name ?? entry.taskName ?? "",
        tagNames,
        running: entry.end === null,
        duration: entrySeconds(entry, now)
    };
}

/** Seconds of the entries that overlap [from, to). */
export function totalBetween(entries: readonly Pick<TimeEntry, "start" | "end">[], from: number, to: number, now: number): number {
    let total = 0;
    for (const e of entries) {
        const end = e.end ?? now;
        const s = Math.max(e.start, from);
        const t = Math.min(end, to);
        if (t > s) total += (t - s) / 1000;
    }
    return Math.round(total);
}

export function sortNewestFirst<T extends { start: number }>(entries: readonly T[]): T[] {
    return [...entries].sort((a, b) => b.start - a.start);
}

/** Groups by local start day, newest day and newest entry first. */
export function groupByDay(entries: readonly EntryView[], now: number): DayGroup[] {
    const groups: DayGroup[] = [];
    const byKey = new Map<string, DayGroup>();
    for (const e of sortNewestFirst(entries)) {
        const key = dayKey(e.start);
        let group = byKey.get(key);
        if (!group) {
            group = { key, dayStart: startOfDay(e.start), daysAgo: daysAgo(e.start, now), total: 0, entries: [] };
            byKey.set(key, group);
            groups.push(group);
        }
        group.entries.push(e);
        group.total += entrySeconds(e, now);
    }
    return groups;
}

/** Replaces by id or inserts, newest first. */
export function upsert(entries: readonly TimeEntry[], entry: TimeEntry): TimeEntry[] {
    return sortNewestFirst([...entries.filter(e => e.id !== entry.id), entry]);
}

export function removeById(entries: readonly TimeEntry[], id: string): TimeEntry[] {
    return entries.filter(e => e.id !== id);
}

export function emptyDraft(defaults: { projectId?: string | null; taskId?: string | null; billable?: boolean } = {}): EntryDraft {
    return {
        description: "",
        projectId: defaults.projectId || null,
        taskId: defaults.projectId ? defaults.taskId || null : null,
        tagIds: [],
        billable: defaults.billable ?? false,
        start: null,
        end: null
    };
}

export function draftFromEntry(entry: TimeEntry): EntryDraft {
    return {
        description: entry.description,
        projectId: entry.projectId,
        taskId: entry.taskId,
        tagIds: [...entry.tagIds],
        billable: entry.billable,
        start: entry.start,
        end: entry.end
    };
}

/** Merges a patch; switching project drops a task that belonged to the previous one. */
export function applyPatch(draft: EntryDraft, patch: Partial<EntryDraft>): EntryDraft {
    const next: EntryDraft = { ...draft, ...patch, tagIds: toArray<string>(patch.tagIds ?? draft.tagIds).slice() };
    if (patch.projectId !== undefined && patch.projectId !== draft.projectId && patch.taskId === undefined) next.taskId = null;
    if (!next.projectId) next.projectId = null;
    if (!next.taskId) next.taskId = null;
    return next;
}

export const NO_REQUIREMENTS: Requirements = { project: false, task: false, description: false, tags: false };

/** Provider-wide requirements combined with the workspace's own rules. */
export function effectiveRequirements(caps: Capabilities, workspace: Pick<Workspace, "requirements"> | null | undefined): Requirements {
    const ws = workspace?.requirements ?? NO_REQUIREMENTS;
    return {
        project: caps.projects && (caps.requiresProject || ws.project),
        task: caps.tasks && (caps.requiresTask || ws.task),
        description: ws.description,
        tags: caps.tags && ws.tags
    };
}

/** Checks a draft before it is sent; returns "" when valid. */
export function validateDraft(draft: EntryDraft, requirements: Requirements, options: { requireEnd?: boolean } = {}): DraftError {
    if (draft.start === null || Number.isNaN(draft.start)) return "missing-start";
    if (options.requireEnd && draft.end === null) return "missing-end";
    if (draft.end !== null && draft.end <= draft.start) return "end-before-start";
    if (requirements.project && !draft.projectId) return "missing-project";
    if (requirements.task && !draft.taskId) return "missing-task";
    if (requirements.description && !draft.description.trim()) return "missing-description";
    if (requirements.tags && draft.tagIds.length === 0) return "missing-tags";
    return "";
}

/** Strips fields the provider does not support and fixes types; call after validateDraft. */
export function toInput(draft: EntryDraft, caps: Capabilities): EntryInput {
    if (draft.start === null) throw new Error("draft has no start time");
    return {
        description: draft.description.trim(),
        projectId: caps.projects ? draft.projectId || null : null,
        taskId: caps.tasks && draft.projectId ? draft.taskId || null : null,
        tagIds: caps.tags ? [...draft.tagIds] : [],
        billable: caps.billable ? draft.billable : false,
        start: draft.start,
        end: draft.end
    };
}

/** Projects without archived ones, sorted by client then name (case-insensitive). */
export function sortProjects(projects: readonly Project[]): Project[] {
    const cmp = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
    return projects.filter(p => !p.archived).sort((a, b) => cmp(a.clientName, b.clientName) || cmp(a.name, b.name));
}

export function projectLabel(project: Pick<Project, "name" | "clientName"> | null | undefined): string {
    if (!project) return "";
    return project.clientName ? `${project.name} · ${project.clientName}` : project.name;
}

export interface Options {
    labels: string[];
    values: string[];
}

/** Dropdown options; the first one is "none" with value "". */
export function projectOptions(projects: readonly Project[], noneLabel: string): Options {
    const sorted = sortProjects(projects);
    return {
        labels: [noneLabel, ...sorted.map(projectLabel)],
        values: ["", ...sorted.map(p => p.id)]
    };
}

export function taskOptions(tasks: readonly Task[], noneLabel: string): Options {
    const sorted = [...tasks].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return {
        labels: [noneLabel, ...sorted.map(t => t.name)],
        values: ["", ...sorted.map(t => t.id)]
    };
}

/** Distinct recent (description, project) pairs, newest first, filtered by query. */
export function recentSuggestions(entries: readonly EntryView[], query: string, limit = 8): EntryView[] {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const out: EntryView[] = [];
    for (const e of sortNewestFirst(entries)) {
        if (out.length >= limit) break;
        if (!e.description) continue;
        const key = `${e.description}\u0000${e.projectId ?? ""}`;
        if (seen.has(key)) continue;
        if (q && !e.description.toLowerCase().includes(q) && !e.projectName.toLowerCase().includes(q)) continue;
        seen.add(key);
        out.push(e);
    }
    return out;
}
