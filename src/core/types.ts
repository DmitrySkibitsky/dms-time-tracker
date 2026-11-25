// Provider-neutral domain model shared by the store, the UI and every provider adapter.
// All timestamps are epoch milliseconds; durations are seconds.

export interface User {
    id: string;
    name: string;
    email: string;
    /** Workspace the provider considers current for this user, if any. */
    defaultWorkspaceId: string | null;
}

/** Fields that must be filled before an entry can be saved. */
export interface Requirements {
    project: boolean;
    task: boolean;
    description: boolean;
    tags: boolean;
}

export interface Workspace {
    id: string;
    name: string;
    /** Workspace-level rules (e.g. Clockify "force projects"); merged with provider capabilities. */
    requirements: Requirements;
}

export interface Project {
    id: string;
    name: string;
    /** CSS colour such as "#03A9F4", or "" when the provider has none. */
    color: string;
    clientName: string;
    billable: boolean;
    archived: boolean;
}

export interface Task {
    id: string;
    name: string;
    projectId: string;
}

export interface Tag {
    id: string;
    name: string;
}

export interface TimeEntry {
    id: string;
    description: string;
    projectId: string | null;
    taskId: string | null;
    tagIds: string[];
    billable: boolean;
    start: number;
    /** null while the timer is running. */
    end: number | null;
    /**
     * Display hints some providers return alongside the entry (e.g. archived projects
     * that are not in the project list). The store falls back to them for labels.
     */
    projectName?: string;
    projectColor?: string;
    taskName?: string;
    tagNames?: string[];
}

/** Editable fields of an entry, as held by editors and the "next timer" form. */
export interface EntryDraft {
    description: string;
    projectId: string | null;
    taskId: string | null;
    tagIds: string[];
    billable: boolean;
    start: number | null;
    end: number | null;
}

/** A draft that is ready to be sent to a provider. */
export interface EntryInput {
    description: string;
    projectId: string | null;
    taskId: string | null;
    tagIds: string[];
    billable: boolean;
    start: number;
    end: number | null;
}

export interface TimeRange {
    from: number;
    to: number;
}

/** What a provider supports. The UI hides unsupported fields; validation enforces requirements. */
export interface Capabilities {
    /** Several workspaces per account (otherwise a single implicit workspace). */
    workspaces: boolean;
    projects: boolean;
    tasks: boolean;
    tags: boolean;
    billable: boolean;
    /** Projects carry colours worth showing. */
    projectColors: boolean;
    /** Entries can't be saved without a project. */
    requiresProject: boolean;
    /** Entries can't be saved without a task. */
    requiresTask: boolean;
    /** The start time of the running timer can be edited. */
    editRunningEntry: boolean;
}

export type SettingKind = "text" | "secret" | "url";

/** Declarative description of a provider setting; the settings screen renders these. */
export interface SettingField {
    key: string;
    label: string;
    description: string;
    kind: SettingKind;
    placeholder: string;
    defaultValue: string;
    required: boolean;
}

export type ProviderSettings = Record<string, string>;

/** HTTP request handed to a transport. */
export interface HttpRequest {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    headers: Record<string, string>;
    body: string | null;
}

/** HTTP response; status 0 means the request never reached the server. */
export interface HttpResponse {
    status: number;
    body: string;
}

export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export interface ProviderContext {
    settings: ProviderSettings;
    transport: Transport;
}

/**
 * Adapter contract every tracking service implements.
 * Methods throw TrackerError on failure.
 */
export interface TrackerProvider {
    readonly capabilities: Capabilities;
    getUser(): Promise<User>;
    listWorkspaces(): Promise<Workspace[]>;
    listProjects(workspaceId: string): Promise<Project[]>;
    listTasks(workspaceId: string, projectId: string): Promise<Task[]>;
    listTags(workspaceId: string): Promise<Tag[]>;
    /** The running entry or null. */
    getRunning(workspaceId: string): Promise<TimeEntry | null>;
    /** Entries that started inside the range, any order. May include the running entry. */
    listEntries(workspaceId: string, range: TimeRange): Promise<TimeEntry[]>;
    /** Starts a timer (input.end is null). The store stops a running timer before calling this. */
    startTimer(workspaceId: string, input: EntryInput): Promise<TimeEntry>;
    stopTimer(workspaceId: string, running: TimeEntry, end: number): Promise<TimeEntry>;
    /** Creates a finished entry (input.end set). */
    createEntry(workspaceId: string, input: EntryInput): Promise<TimeEntry>;
    /** Replaces an entry. A null end keeps a running entry running. */
    updateEntry(workspaceId: string, entryId: string, input: EntryInput): Promise<TimeEntry>;
    deleteEntry(workspaceId: string, entryId: string): Promise<void>;
}

export interface ProviderDescriptor {
    id: string;
    name: string;
    /** Material icon name. */
    icon: string;
    homepage: string;
    capabilities: Capabilities;
    settings: SettingField[];
    create(context: ProviderContext): TrackerProvider;
}

export type ErrorKind = "config" | "auth" | "network" | "not-found" | "validation" | "rate-limit" | "server" | "unknown";

export class TrackerError extends Error {
    readonly kind: ErrorKind;
    readonly status: number;

    constructor(kind: ErrorKind, message: string, status = 0) {
        super(message);
        this.name = "TrackerError";
        this.kind = kind;
        this.status = status;
    }
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
}
