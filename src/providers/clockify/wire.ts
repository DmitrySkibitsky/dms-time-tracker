// Shapes of the Clockify REST v1 payloads used by the adapter, and their mapping to the domain model.
// Only the fields the plugin reads are declared.

import { parseIso, toIso } from "../../core/time.ts";
import type { EntryInput, Project, Requirements, Tag, Task, TimeEntry, User, Workspace } from "../../core/types.ts";

export interface ClockifyUser {
    id: string;
    name?: string;
    email?: string;
    activeWorkspace?: string;
    defaultWorkspace?: string;
}

export interface ClockifyWorkspace {
    id: string;
    name?: string;
    workspaceSettings?: {
        forceProjects?: boolean;
        forceTasks?: boolean;
        forceDescription?: boolean;
        forceTags?: boolean;
    };
}

export interface ClockifyProject {
    id: string;
    name?: string;
    color?: string;
    clientName?: string;
    billable?: boolean;
    archived?: boolean;
}

export interface ClockifyTask {
    id: string;
    name?: string;
    projectId?: string;
}

export interface ClockifyTag {
    id: string;
    name?: string;
}

export interface ClockifyTimeEntry {
    id: string;
    description?: string | null;
    projectId?: string | null;
    taskId?: string | null;
    tagIds?: string[] | null;
    billable?: boolean;
    timeInterval?: {
        start?: string | null;
        end?: string | null;
        duration?: string | null;
    };
    // Present with ?hydrated=true
    project?: { id?: string; name?: string; color?: string } | null;
    task?: { id?: string; name?: string } | null;
    tags?: { id: string; name?: string }[] | null;
}

export interface ClockifyEntryBody {
    start: string;
    end?: string;
    description: string;
    projectId: string | null;
    taskId: string | null;
    tagIds: string[];
    billable: boolean;
}

export function toUser(raw: ClockifyUser): User {
    return {
        id: raw.id,
        name: raw.name ?? "",
        email: raw.email ?? "",
        defaultWorkspaceId: raw.activeWorkspace || raw.defaultWorkspace || null
    };
}

export function toWorkspace(raw: ClockifyWorkspace): Workspace {
    const s = raw.workspaceSettings ?? {};
    const requirements: Requirements = {
        project: !!s.forceProjects,
        task: !!s.forceTasks,
        description: !!s.forceDescription,
        tags: !!s.forceTags
    };
    return { id: raw.id, name: raw.name ?? raw.id, requirements };
}

export function toProject(raw: ClockifyProject): Project {
    return {
        id: raw.id,
        name: raw.name ?? "",
        color: raw.color ?? "",
        clientName: raw.clientName ?? "",
        billable: !!raw.billable,
        archived: !!raw.archived
    };
}

export function toTask(raw: ClockifyTask, projectId: string): Task {
    return { id: raw.id, name: raw.name ?? "", projectId: raw.projectId ?? projectId };
}

export function toTag(raw: ClockifyTag): Tag {
    return { id: raw.id, name: raw.name ?? "" };
}

export function toTimeEntry(raw: ClockifyTimeEntry): TimeEntry {
    const start = parseIso(raw.timeInterval?.start);
    if (start === null) throw new Error(`Clockify entry ${raw.id} has no start time`);
    const tagIds = raw.tagIds ?? raw.tags?.map(t => t.id) ?? [];
    const entry: TimeEntry = {
        id: raw.id,
        description: raw.description ?? "",
        projectId: raw.projectId || null,
        taskId: raw.taskId || null,
        tagIds: [...tagIds],
        billable: !!raw.billable,
        start,
        end: parseIso(raw.timeInterval?.end)
    };
    if (raw.project?.name) entry.projectName = raw.project.name;
    if (raw.project?.color) entry.projectColor = raw.project.color;
    if (raw.task?.name) entry.taskName = raw.task.name;
    if (raw.tags) {
        const byId = new Map(raw.tags.map(t => [t.id, t.name ?? ""]));
        entry.tagNames = tagIds.map(id => byId.get(id) ?? "");
    }
    return entry;
}

export function toEntryBody(input: EntryInput): ClockifyEntryBody {
    const body: ClockifyEntryBody = {
        start: toIso(input.start),
        description: input.description,
        projectId: input.projectId,
        taskId: input.taskId,
        tagIds: [...input.tagIds],
        billable: input.billable
    };
    if (input.end !== null) body.end = toIso(input.end);
    return body;
}
