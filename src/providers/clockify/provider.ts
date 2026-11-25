import { JsonClient, type Query, seg } from "../../core/http.ts";
import { toIso } from "../../core/time.ts";
import {
    type Capabilities,
    type EntryInput,
    type Project,
    type ProviderContext,
    type ProviderDescriptor,
    type Tag,
    type Task,
    type TimeEntry,
    type TimeRange,
    TrackerError,
    type TrackerProvider,
    type User,
    type Workspace
} from "../../core/types.ts";
import {
    type ClockifyProject,
    type ClockifyTag,
    type ClockifyTask,
    type ClockifyTimeEntry,
    type ClockifyUser,
    type ClockifyWorkspace,
    toEntryBody,
    toProject,
    toTag,
    toTask,
    toTimeEntry,
    toUser,
    toWorkspace
} from "./wire.ts";

export const CLOCKIFY_DEFAULT_URL = "https://api.clockify.me/api/v1";

/** Page size for list endpoints; Clockify accepts up to 5000 but smaller pages keep responses fast. */
export const PAGE_SIZE = 200;
/** Safety cap on pagination. */
export const MAX_PAGES = 25;

export const clockifyCapabilities: Capabilities = {
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

export class ClockifyProvider implements TrackerProvider {
    readonly capabilities = clockifyCapabilities;
    private readonly client: JsonClient;
    private userPromise: Promise<User> | null = null;

    constructor(context: ProviderContext) {
        const apiKey = (context.settings.apiKey ?? "").trim();
        if (!apiKey) throw new TrackerError("config", "Clockify API key is not set");
        this.client = new JsonClient({
            baseUrl: context.settings.baseUrl?.trim() || CLOCKIFY_DEFAULT_URL,
            headers: { "X-Api-Key": apiKey },
            transport: context.transport
        });
    }

    /** The user is needed for most paths; fetched once and reused. */
    getUser(): Promise<User> {
        if (!this.userPromise) {
            this.userPromise = this.client.get<ClockifyUser>("/user").then(toUser);
            this.userPromise.catch(() => {
                this.userPromise = null;
            });
        }
        return this.userPromise;
    }

    private userPath(workspaceId: string): Promise<string> {
        return this.getUser().then(user => `/workspaces/${seg(workspaceId)}/user/${seg(user.id)}/time-entries`);
    }

    /** Follows pages until a short one; sequential to keep request order and rate predictable. */
    private fetchAll<T>(path: string, query: Query): Promise<T[]> {
        const all: T[] = [];
        const page = (n: number): Promise<T[]> =>
            this.client.get<T[] | null>(path, { ...query, page: n, "page-size": PAGE_SIZE }).then(items => {
                const list = items ?? [];
                all.push(...list);
                return list.length < PAGE_SIZE || n >= MAX_PAGES ? all : page(n + 1);
            });
        return page(1);
    }

    listWorkspaces(): Promise<Workspace[]> {
        return this.client.get<ClockifyWorkspace[] | null>("/workspaces").then(list => (list ?? []).map(toWorkspace));
    }

    listProjects(workspaceId: string): Promise<Project[]> {
        return this.fetchAll<ClockifyProject>(`/workspaces/${seg(workspaceId)}/projects`, { archived: "false" }).then(list =>
            list.map(toProject)
        );
    }

    listTasks(workspaceId: string, projectId: string): Promise<Task[]> {
        return this.fetchAll<ClockifyTask>(`/workspaces/${seg(workspaceId)}/projects/${seg(projectId)}/tasks`, {
            "is-active": "true"
        }).then(list => list.map(raw => toTask(raw, projectId)));
    }

    listTags(workspaceId: string): Promise<Tag[]> {
        return this.fetchAll<ClockifyTag>(`/workspaces/${seg(workspaceId)}/tags`, { archived: "false" }).then(list => list.map(toTag));
    }

    getRunning(workspaceId: string): Promise<TimeEntry | null> {
        return this.userPath(workspaceId)
            .then(path => this.client.get<ClockifyTimeEntry[] | null>(path, { "in-progress": "true", hydrated: "true" }))
            .then(list => {
                const raw = list?.[0];
                return raw ? toTimeEntry(raw) : null;
            });
    }

    listEntries(workspaceId: string, range: TimeRange): Promise<TimeEntry[]> {
        return this.userPath(workspaceId)
            .then(path => this.fetchAll<ClockifyTimeEntry>(path, { start: toIso(range.from), end: toIso(range.to), hydrated: "true" }))
            .then(list => list.map(toTimeEntry));
    }

    startTimer(workspaceId: string, input: EntryInput): Promise<TimeEntry> {
        if (input.end !== null) return Promise.reject(new TrackerError("validation", "A new timer must not have an end time"));
        return this.post(workspaceId, input);
    }

    createEntry(workspaceId: string, input: EntryInput): Promise<TimeEntry> {
        if (input.end === null) return Promise.reject(new TrackerError("validation", "A manual entry needs an end time"));
        return this.post(workspaceId, input);
    }

    private post(workspaceId: string, input: EntryInput): Promise<TimeEntry> {
        return this.client
            .request<ClockifyTimeEntry>("POST", `/workspaces/${seg(workspaceId)}/time-entries`, { body: toEntryBody(input) })
            .then(toTimeEntry);
    }

    stopTimer(workspaceId: string, _running: TimeEntry, end: number): Promise<TimeEntry> {
        return this.userPath(workspaceId)
            .then(path => this.client.request<ClockifyTimeEntry>("PATCH", path, { body: { end: toIso(end) } }))
            .then(toTimeEntry);
    }

    updateEntry(workspaceId: string, entryId: string, input: EntryInput): Promise<TimeEntry> {
        return this.client
            .request<ClockifyTimeEntry>("PUT", `/workspaces/${seg(workspaceId)}/time-entries/${seg(entryId)}`, { body: toEntryBody(input) })
            .then(toTimeEntry);
    }

    deleteEntry(workspaceId: string, entryId: string): Promise<void> {
        return this.client.request<null>("DELETE", `/workspaces/${seg(workspaceId)}/time-entries/${seg(entryId)}`).then(() => undefined);
    }
}

export const clockifyDescriptor: ProviderDescriptor = {
    id: "clockify",
    name: "Clockify",
    icon: "timer",
    homepage: "https://clockify.me",
    capabilities: clockifyCapabilities,
    settings: [
        {
            key: "apiKey",
            label: "API key",
            description: "Generate it in Clockify → Profile settings → API → Generate.",
            kind: "secret",
            placeholder: "Paste your Clockify API key",
            defaultValue: "",
            required: true
        },
        {
            key: "baseUrl",
            label: "API URL",
            description: "Change only for regional or self-hosted Clockify instances.",
            kind: "url",
            placeholder: CLOCKIFY_DEFAULT_URL,
            defaultValue: CLOCKIFY_DEFAULT_URL,
            required: false
        }
    ],
    create: context => new ClockifyProvider(context)
};
