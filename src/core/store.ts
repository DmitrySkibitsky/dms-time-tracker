import {
    applyPatch,
    type DayGroup,
    type DraftError,
    draftFromEntry,
    type EntryView,
    effectiveRequirements,
    emptyDraft,
    groupByDay,
    indexById,
    type Lookups,
    removeById,
    sortProjects,
    toInput,
    totalBetween,
    toView,
    upsert,
    validateDraft
} from "./entries.ts";
import { addDays, startOfDay, startOfWeek } from "./time.ts";
import {
    type Capabilities,
    type EntryDraft,
    type ErrorKind,
    errorMessage,
    type Project,
    type ProviderDescriptor,
    type ProviderSettings,
    type Requirements,
    type Tag,
    type Task,
    type TimeEntry,
    TrackerError,
    type TrackerProvider,
    type Transport,
    type User,
    type Workspace
} from "./types.ts";

export interface StoreConfig {
    /** Active account; switching accounts always reloads and resets the timer form. */
    accountId: string;
    providerId: string;
    /** Provider settings keyed by SettingField.key. */
    settings: ProviderSettings;
    /** Preferred workspace; "" = the provider's default. */
    workspaceId: string;
    defaultProjectId: string;
    defaultTaskId: string;
    /** Billable flag of new timers; the UI remembers the last choice here. */
    defaultBillable: boolean;
    /** How many days of history to keep (today included). */
    historyDays: number;
    /** 0 = Sunday, 1 = Monday. */
    weekStart: number;
}

export type Status = "unconfigured" | "loading" | "ready" | "error";

export interface StoreState {
    status: Status;
    /** Last load/refresh error (empty when healthy). */
    error: string;
    errorKind: ErrorKind | "";
    /** Number of mutations in flight. */
    pending: number;
    providerId: string;
    providerName: string;
    capabilities: Capabilities;
    requirements: Requirements;
    user: User | null;
    workspaces: Workspace[];
    workspaceId: string;
    workspaceName: string;
    /** Active projects, sorted by client and name. */
    projects: Project[];
    tags: Tag[];
    /** Loaded tasks per project id. */
    tasks: Record<string, Task[]>;
    running: EntryView | null;
    /** Finished entries inside the history window, newest first. */
    entries: EntryView[];
    days: DayGroup[];
    /** The form for the next timer. */
    draft: EntryDraft;
    /** Totals of finished entries; add the running timer with liveTotal(). */
    todayFinished: number;
    weekFinished: number;
    dayStart: number;
    weekStartMs: number;
    lastSync: number;
}

export type ResultCode = "" | DraftError | "not-ready" | "not-found" | "not-running" | "start-in-future" | ErrorKind;

/** Outcome of an action. Actions never reject. */
export interface ActionResult {
    ok: boolean;
    code: ResultCode;
    error: string;
}

export interface StoreOptions {
    providers: readonly ProviderDescriptor[];
    transport: Transport;
    now?: () => number;
    onChange?: (state: StoreState) => void;
    /** Called for failures the user should see (mutations, loads). */
    onError?: (message: string, code: ResultCode) => void;
}

const OK: ActionResult = { ok: true, code: "", error: "" };

/** How long account catalogues (workspaces, projects, tags, tasks) are reused. */
export const CATALOGUE_TTL_MS = 15 * 60_000;

/** Account data that rarely changes, cached per account. */
interface Catalogue {
    fetchedAt: number;
    user: User;
    workspaces: Workspace[];
    workspaceId: string;
    projects: Project[];
    tags: Tag[];
    tasks: Record<string, Task[]>;
}

const NO_CAPABILITIES: Capabilities = {
    workspaces: false,
    projects: false,
    tasks: false,
    tags: false,
    billable: false,
    projectColors: false,
    requiresProject: false,
    requiresTask: false,
    editRunningEntry: false
};

export const DEFAULT_CONFIG: StoreConfig = {
    accountId: "",
    providerId: "",
    settings: {},
    workspaceId: "",
    defaultProjectId: "",
    defaultTaskId: "",
    defaultBillable: false,
    historyDays: 14,
    weekStart: 1
};

function sameSettings(a: ProviderSettings, b: ProviderSettings): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if ((a[key] ?? "") !== (b[key] ?? "")) return false;
    }
    return true;
}

function failure(code: ResultCode, error: string): ActionResult {
    return { ok: false, code, error };
}

/** Seconds tracked in [from, to) including the running timer up to now. */
export function liveTotal(state: Pick<StoreState, "running">, finished: number, from: number, to: number, now: number): number {
    return finished + (state.running ? totalBetween([state.running], from, to, now) : 0);
}

/**
 * Provider-neutral tracker state and actions. The host (QML) drives time:
 * it calls refresh() periodically; the store owns no timers.
 */
export class TrackerStore {
    private readonly options: StoreOptions;
    private readonly now: () => number;
    private config: StoreConfig = { ...DEFAULT_CONFIG };
    private provider: TrackerProvider | null = null;
    private descriptor: ProviderDescriptor | null = null;
    /** Bumped on every reload; results of older loads are discarded. */
    private generation = 0;
    private refreshing = false;
    private draftTouched = false;
    /** Providers per cacheKey(), so e.g. Clockify's cached user survives account switches. */
    private readonly providerCache = new Map<string, TrackerProvider>();
    private readonly catalogues = new Map<string, Catalogue>();
    private readonly taskLoads = new Map<string, Promise<Task[]>>();

    private status: Status = "unconfigured";
    private error = "";
    private errorKind: ErrorKind | "" = "";
    private pending = 0;
    private user: User | null = null;
    private workspaces: Workspace[] = [];
    private workspaceId = "";
    private projects: Project[] = [];
    private tags: Tag[] = [];
    private tasks: Record<string, Task[]> = {};
    private running: TimeEntry | null = null;
    private entries: TimeEntry[] = [];
    private draft: EntryDraft = emptyDraft();
    private lastSync = 0;
    private snapshot: StoreState;

    constructor(options: StoreOptions) {
        this.options = options;
        this.now = options.now ?? (() => Date.now());
        this.snapshot = this.buildState();
    }

    get state(): StoreState {
        return this.snapshot;
    }

    get currentConfig(): StoreConfig {
        return { ...this.config, settings: { ...this.config.settings } };
    }

    /**
     * Applies settings. Reloads everything when the provider, its settings or the workspace
     * changed; otherwise only updates defaults.
     */
    configure(next: Partial<StoreConfig>): Promise<ActionResult> {
        const prev = this.config;
        const config: StoreConfig = { ...prev, ...next, settings: { ...(next.settings ?? prev.settings) } };
        config.historyDays = Math.max(1, Math.min(90, Math.floor(config.historyDays) || DEFAULT_CONFIG.historyDays));
        this.config = config;

        const accountChanged = config.accountId !== prev.accountId;
        const needsReload =
            !this.provider ||
            accountChanged ||
            config.providerId !== prev.providerId ||
            !sameSettings(config.settings, prev.settings) ||
            config.workspaceId !== prev.workspaceId;

        // A half-typed timer belongs to the account it was typed for.
        if (accountChanged) this.draftTouched = false;
        if (!this.draftTouched) this.draft = this.defaultDraft();

        if (needsReload) return this.reload(false);
        if (this.draft.projectId) void this.loadTasks(this.draft.projectId);
        if (config.historyDays !== prev.historyDays || config.weekStart !== prev.weekStart) return this.refresh();
        this.emit();
        return Promise.resolve(OK);
    }

    /** Next-timer form prefilled with the default project, unless it isn't in the loaded workspace. */
    private defaultDraft(): EntryDraft {
        const projectId = this.config.defaultProjectId;
        const known = !projectId || this.projects.length === 0 || this.projects.some(p => p.id === projectId);
        const billable = this.config.defaultBillable;
        return known ? emptyDraft({ projectId, taskId: this.config.defaultTaskId, billable }) : emptyDraft({ billable });
    }

    private createProvider(): TrackerProvider | null {
        this.descriptor = this.options.providers.find(p => p.id === this.config.providerId) ?? null;
        if (!this.descriptor) throw new TrackerError("config", `Unknown provider "${this.config.providerId}"`);
        for (const field of this.descriptor.settings) {
            if (field.required && !(this.config.settings[field.key] ?? "").trim()) return null;
        }
        return this.descriptor.create({ settings: this.config.settings, transport: this.options.transport });
    }

    private resetData(): void {
        this.taskLoads.clear();
        this.user = null;
        this.workspaces = [];
        this.workspaceId = "";
        this.projects = [];
        this.tags = [];
        this.tasks = {};
        this.running = null;
        this.entries = [];
    }

    /** Full load: user, workspaces, catalogues, running timer and history. */
    /**
     * Loads the account: catalogues (user, workspaces, projects, tags) and the timeline (running
     * timer, history). Catalogues are cached per account for CATALOGUE_TTL_MS, so switching back
     * to an account costs two requests; `force` (Reconnect, error recovery) refetches them.
     */
    reload(force = true): Promise<ActionResult> {
        const gen = ++this.generation;
        this.resetData();
        const key = this.cacheKey();
        let provider = this.providerCache.get(key) ?? null;
        if (!provider) {
            try {
                provider = this.createProvider();
            } catch (e) {
                this.provider = null;
                return Promise.resolve(this.fail(gen, e));
            }
            if (provider) this.providerCache.set(key, provider);
        } else {
            this.descriptor = this.options.providers.find(p => p.id === this.config.providerId) ?? null;
        }
        this.provider = provider;
        if (!provider) {
            this.status = "unconfigured";
            this.error = "";
            this.errorKind = "";
            this.emit();
            return Promise.resolve(failure("config", "The provider is not configured"));
        }
        if (force) this.catalogues.delete(key);
        const cached = this.catalogues.get(key);
        const fresh = cached !== undefined && this.now() - cached.fetchedAt < CATALOGUE_TTL_MS;
        this.status = "loading";
        this.error = "";
        this.errorKind = "";
        this.emit();
        const stale = new Error("stale load");
        return (fresh ? Promise.resolve(cached) : this.fetchCatalogue(provider))
            .then(catalogue => {
                if (gen !== this.generation) throw stale;
                this.catalogues.set(key, catalogue);
                this.user = catalogue.user;
                this.workspaces = catalogue.workspaces;
                this.workspaceId = catalogue.workspaceId;
                this.projects = catalogue.projects;
                this.tags = catalogue.tags;
                this.tasks = catalogue.tasks;
                return Promise.all([
                    provider.getRunning(catalogue.workspaceId),
                    provider.listEntries(catalogue.workspaceId, this.historyRange())
                ]);
            })
            .then(([running, entries]) => {
                if (gen !== this.generation) return OK;
                this.applyTimeline(running, entries);
                if (!this.draftTouched) this.draft = this.defaultDraft();
                this.status = "ready";
                this.lastSync = this.now();
                this.emit();
                if (this.draft.projectId) void this.loadTasks(this.draft.projectId);
                return OK;
            })
            .catch((e: unknown) => (e === stale ? OK : this.fail(gen, e)));
    }

    /** Identifies cached providers/catalogues: same account, service, credentials and workspace choice. */
    private cacheKey(): string {
        const settings = Object.keys(this.config.settings)
            .sort()
            .map(k => `${k}=${this.config.settings[k] ?? ""}`)
            .join("&");
        return [this.config.accountId, this.config.providerId, settings, this.config.workspaceId].join("\u0000");
    }

    private fetchCatalogue(provider: TrackerProvider): Promise<Catalogue> {
        const caps = provider.capabilities;
        return Promise.all([provider.getUser(), provider.listWorkspaces()]).then(([user, workspaces]) => {
            if (workspaces.length === 0) throw new TrackerError("not-found", "The account has no workspaces");
            const preferred = [this.config.workspaceId, user.defaultWorkspaceId ?? ""].find(id => id && workspaces.some(w => w.id === id));
            const workspaceId = preferred ?? (workspaces[0] as Workspace).id;
            return Promise.all([
                caps.projects ? provider.listProjects(workspaceId) : Promise.resolve([] as Project[]),
                caps.tags ? provider.listTags(workspaceId) : Promise.resolve([] as Tag[])
            ]).then(
                ([projects, tags]): Catalogue => ({
                    fetchedAt: this.now(),
                    user,
                    workspaces,
                    workspaceId,
                    projects: sortProjects(projects),
                    tags: [...tags].sort((a, b) => a.name.localeCompare(b.name)),
                    tasks: {}
                })
            );
        });
    }

    private fail(gen: number, e: unknown): ActionResult {
        if (gen !== this.generation) return OK;
        const kind: ErrorKind = e instanceof TrackerError ? e.kind : "unknown";
        this.status = "error";
        this.error = errorMessage(e);
        this.errorKind = kind;
        this.emit();
        this.options.onError?.(this.error, kind);
        return failure(kind, this.error);
    }

    private historyRange() {
        const now = this.now();
        return { from: addDays(startOfDay(now), -(this.config.historyDays - 1)), to: addDays(startOfDay(now), 1) };
    }

    private applyTimeline(running: TimeEntry | null, entries: TimeEntry[]): void {
        this.running = running;
        const finished = entries.filter(e => e.end !== null && e.id !== running?.id);
        this.entries = finished.sort((a, b) => b.start - a.start);
    }

    /**
     * Re-reads the running timer and history (cheap periodic sync). Skipped while a
     * mutation is in flight or another refresh runs, so it can't clobber fresh results.
     */
    refresh(): Promise<ActionResult> {
        const provider = this.provider;
        if (!provider || this.status === "loading" || this.status === "unconfigured")
            return Promise.resolve(failure("not-ready", "Not connected"));
        if (this.status === "error") return this.reload();
        if (this.refreshing || this.pending > 0) return Promise.resolve(OK);
        const gen = this.generation;
        this.refreshing = true;
        return Promise.all([provider.getRunning(this.workspaceId), provider.listEntries(this.workspaceId, this.historyRange())]).then(
            ([running, entries]) => {
                this.refreshing = false;
                if (gen !== this.generation || this.pending > 0) return OK;
                const before = JSON.stringify([this.running, this.entries]);
                this.applyTimeline(running, entries);
                this.lastSync = this.now();
                const changed = this.error !== "" || JSON.stringify([this.running, this.entries]) !== before;
                this.error = "";
                this.errorKind = "";
                // Unchanged polls don't emit, so views (lists, scroll positions) stay untouched.
                if (changed || this.dayChanged()) this.emit();
                return OK;
            },
            (e: unknown) => {
                this.refreshing = false;
                if (gen !== this.generation) return OK;
                // Keep showing cached data; surface the problem without flipping to the error screen.
                this.error = errorMessage(e);
                this.errorKind = e instanceof TrackerError ? e.kind : "unknown";
                this.emit();
                return failure(this.errorKind, this.error);
            }
        );
    }

    /** True once midnight passed since the last snapshot (day labels and totals shift). */
    private dayChanged(): boolean {
        return startOfDay(this.now()) !== this.snapshot.dayStart;
    }

    /** Switches workspace for this session and reloads. Persisting it is the host's job. */
    selectWorkspace(workspaceId: string): Promise<ActionResult> {
        return this.configure({ workspaceId });
    }

    /** Loads (once) and caches the tasks of a project; concurrent calls share one request. */
    loadTasks(projectId: string): Promise<Task[]> {
        const provider = this.provider;
        if (!provider?.capabilities.tasks || !projectId || this.status !== "ready") return Promise.resolve([]);
        const cached = this.tasks[projectId];
        if (cached) return Promise.resolve(cached);
        const inFlight = this.taskLoads.get(projectId);
        if (inFlight) return inFlight;
        const gen = this.generation;
        // No Promise.prototype.finally: the QML V4 engine doesn't implement it.
        const load = provider.listTasks(this.workspaceId, projectId).then(
            tasks => {
                this.taskLoads.delete(projectId);
                if (gen !== this.generation) return [];
                const sorted = [...tasks].sort((a, b) => a.name.localeCompare(b.name));
                this.tasks = { ...this.tasks, [projectId]: sorted };
                const catalogue = this.catalogues.get(this.cacheKey());
                if (catalogue) catalogue.tasks = this.tasks;
                this.emit();
                return sorted;
            },
            (e: unknown) => {
                this.taskLoads.delete(projectId);
                this.options.onError?.(errorMessage(e), e instanceof TrackerError ? e.kind : "unknown");
                return [] as Task[];
            }
        );
        this.taskLoads.set(projectId, load);
        return load;
    }

    /** Edits the next-timer form. */
    setDraft(patch: Partial<EntryDraft>): void {
        this.draft = applyPatch(this.draft, patch);
        this.draftTouched = true;
        this.emit();
        if (patch.projectId) void this.loadTasks(patch.projectId);
    }

    resetDraft(): void {
        this.draft = this.defaultDraft();
        this.draftTouched = false;
        this.emit();
    }

    /** Runs a mutation with pending accounting and uniform error reporting. */
    private mutate(
        action: (provider: TrackerProvider, workspaceId: string) => Promise<ActionResult> | ActionResult
    ): Promise<ActionResult> {
        const provider = this.provider;
        if (!provider || this.status !== "ready") return Promise.resolve(this.report(failure("not-ready", "Not connected")));
        const gen = this.generation;
        const workspaceId = this.workspaceId;
        this.pending++;
        this.emit();
        const settle = (result: ActionResult): ActionResult => {
            this.pending--;
            if (gen === this.generation) this.emit();
            return this.report(result);
        };
        return Promise.resolve()
            .then(() => action(provider, workspaceId))
            .then(settle, (e: unknown) => settle(failure(e instanceof TrackerError ? e.kind : "unknown", errorMessage(e))));
    }

    private report(result: ActionResult): ActionResult {
        if (!result.ok) this.options.onError?.(result.error, result.code);
        return result;
    }

    private requirements(): Requirements {
        const caps = this.provider?.capabilities ?? NO_CAPABILITIES;
        return effectiveRequirements(
            caps,
            this.workspaces.find(w => w.id === this.workspaceId)
        );
    }

    private invalid(code: DraftError): ActionResult {
        return failure(code, `Invalid entry: ${code}`);
    }

    /** Starts a timer from the draft (optionally overridden). Stops a running timer first. */
    start(overrides: Partial<EntryDraft> = {}): Promise<ActionResult> {
        return this.mutate((provider, ws) => {
            const now = this.now();
            const draft = applyPatch(this.draft, { ...overrides, start: overrides.start ?? now, end: null });
            if (draft.start !== null && draft.start > now) return failure("start-in-future", "The start time is in the future");
            const code = validateDraft(draft, this.requirements());
            if (code) return this.invalid(code);
            const current = this.running;
            const stopCurrent = current
                ? provider.stopTimer(ws, current, Math.max(now, current.start + 1000)).then(stopped => {
                      this.entries = upsert(this.entries, stopped);
                      this.running = null;
                  })
                : Promise.resolve();
            return stopCurrent
                .then(() => provider.startTimer(ws, toInput(draft, provider.capabilities)))
                .then(started => {
                    this.running = started;
                    this.draft = this.defaultDraft();
                    this.draftTouched = false;
                    return OK;
                });
        });
    }

    stop(): Promise<ActionResult> {
        return this.mutate((provider, ws) => {
            const running = this.running;
            if (!running) return failure("not-running", "No timer is running");
            const end = Math.max(this.now(), running.start + 1000);
            return provider.stopTimer(ws, running, end).then(stopped => {
                this.running = null;
                this.entries = upsert(this.entries, stopped);
                return OK;
            });
        });
    }

    toggle(): Promise<ActionResult> {
        return this.running ? this.stop() : this.start();
    }

    /** Edits the running timer: description, project, task, tags, billable or start time. */
    updateRunning(patch: Partial<EntryDraft>): Promise<ActionResult> {
        return this.mutate((provider, ws) => {
            const running = this.running;
            if (!running) return failure("not-running", "No timer is running");
            const draft = applyPatch(draftFromEntry(running), { ...patch, end: null });
            if (draft.start !== null && draft.start > this.now()) return failure("start-in-future", "The start time is in the future");
            const code = validateDraft(draft, this.requirements());
            if (code) return this.invalid(code);
            return provider.updateEntry(ws, running.id, toInput(draft, provider.capabilities)).then(updated => {
                this.running = updated.end === null ? updated : null;
                if (updated.end !== null) this.entries = upsert(this.entries, updated);
                if (patch.projectId) void this.loadTasks(patch.projectId);
                return OK;
            });
        });
    }

    /** Adds a finished entry (manual time). */
    createEntry(draft: EntryDraft): Promise<ActionResult> {
        return this.mutate((provider, ws) => {
            const code = validateDraft(draft, this.requirements(), { requireEnd: true });
            if (code) return this.invalid(code);
            return provider.createEntry(ws, toInput(draft, provider.capabilities)).then(created => {
                this.addIfInHistory(created);
                return OK;
            });
        });
    }

    /** Replaces a finished entry. */
    updateEntry(entryId: string, draft: EntryDraft): Promise<ActionResult> {
        return this.mutate((provider, ws) => {
            if (!this.entries.some(e => e.id === entryId)) return failure("not-found", "The entry no longer exists");
            const code = validateDraft(draft, this.requirements(), { requireEnd: true });
            if (code) return this.invalid(code);
            return provider.updateEntry(ws, entryId, toInput(draft, provider.capabilities)).then(updated => {
                this.entries = removeById(this.entries, entryId);
                this.addIfInHistory(updated);
                return OK;
            });
        });
    }

    deleteEntry(entryId: string): Promise<ActionResult> {
        return this.mutate((provider, ws) => {
            const isRunning = this.running?.id === entryId;
            if (!isRunning && !this.entries.some(e => e.id === entryId)) return failure("not-found", "The entry no longer exists");
            return provider.deleteEntry(ws, entryId).then(() => {
                if (isRunning) this.running = null;
                else this.entries = removeById(this.entries, entryId);
                return OK;
            });
        });
    }

    /** Starts a new timer with the fields of an existing entry ("continue" in Clockify). */
    continueEntry(entryId: string): Promise<ActionResult> {
        const entry = this.entries.find(e => e.id === entryId);
        if (!entry) return Promise.resolve(this.report(failure("not-found", "The entry no longer exists")));
        const { description, projectId, taskId, tagIds, billable } = entry;
        return this.start({ description, projectId, taskId, tagIds: [...tagIds], billable, start: this.now() });
    }

    /** Creates a copy of a finished entry with the same times. */
    duplicateEntry(entryId: string): Promise<ActionResult> {
        const entry = this.entries.find(e => e.id === entryId);
        if (!entry) return Promise.resolve(this.report(failure("not-found", "The entry no longer exists")));
        return this.createEntry(draftFromEntry(entry));
    }

    private addIfInHistory(entry: TimeEntry): void {
        if (entry.end === null) {
            this.running = entry;
            return;
        }
        const range = this.historyRange();
        if (entry.start >= range.from && entry.start < range.to) this.entries = upsert(this.entries, entry);
    }

    private lookups(): Lookups {
        const tasks = new Map<string, Task>();
        for (const list of Object.values(this.tasks)) {
            for (const t of list) tasks.set(t.id, t);
        }
        return { projects: indexById(this.projects), tasks, tags: indexById(this.tags) };
    }

    private buildState(): StoreState {
        const now = this.now();
        const lookups = this.lookups();
        const entries = this.entries.map(e => toView(e, lookups, now));
        const dayStart = startOfDay(now);
        const weekStartMs = startOfWeek(now, this.config.weekStart);
        const tomorrow = addDays(dayStart, 1);
        const caps = this.provider?.capabilities ?? this.descriptor?.capabilities ?? NO_CAPABILITIES;
        return {
            status: this.status,
            error: this.error,
            errorKind: this.errorKind,
            pending: this.pending,
            providerId: this.config.providerId,
            providerName: this.descriptor?.name ?? "",
            capabilities: caps,
            requirements: this.requirements(),
            user: this.user,
            workspaces: this.workspaces,
            workspaceId: this.workspaceId,
            workspaceName: this.workspaces.find(w => w.id === this.workspaceId)?.name ?? "",
            projects: this.projects,
            tags: this.tags,
            tasks: this.tasks,
            running: this.running ? toView(this.running, lookups, now) : null,
            entries,
            days: groupByDay(entries, now),
            draft: this.draft,
            todayFinished: totalBetween(this.entries, dayStart, tomorrow, now),
            weekFinished: totalBetween(this.entries, weekStartMs, tomorrow, now),
            dayStart,
            weekStartMs,
            lastSync: this.lastSync
        };
    }

    private emit(): void {
        this.snapshot = this.buildState();
        this.options.onChange?.(this.snapshot);
    }
}
