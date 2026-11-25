// In-memory imitation of the Clockify REST v1 endpoints the adapter uses.
// Runs in Node (unit/contract tests, HTTP mock server) and, bundled, inside QML tests.

import type { HttpRequest, HttpResponse, Transport } from "../../src/core/types.ts";

export interface FakeEntry {
    id: string;
    workspaceId: string;
    userId: string;
    description: string;
    projectId: string | null;
    taskId: string | null;
    tagIds: string[];
    billable: boolean;
    start: number;
    end: number | null;
}

export interface LoggedRequest {
    method: string;
    path: string;
    query: Record<string, string>;
    body: unknown;
}

interface FakeProject {
    id: string;
    name: string;
    color: string;
    clientName: string;
    archived: boolean;
    billable: boolean;
}

interface FakeWorkspace {
    id: string;
    name: string;
    workspaceSettings: { forceProjects: boolean; forceTasks: boolean; forceDescription: boolean; forceTags: boolean };
}

export interface FakeState {
    apiKey: string;
    user: { id: string; name: string; email: string; activeWorkspace: string; defaultWorkspace: string };
    workspaces: FakeWorkspace[];
    projects: Record<string, FakeProject[]>;
    tasks: Record<string, { id: string; name: string; projectId: string; status: string }[]>;
    tags: Record<string, { id: string; name: string; archived: boolean }[]>;
    entries: FakeEntry[];
    requests: LoggedRequest[];
    /** Returned once for the next request, then cleared. */
    failNext: { status: number; message: string } | null;
    /** Simulates a dead network for every request while true. */
    offline: boolean;
}

export interface ClockifyFake {
    state: FakeState;
    handle(request: HttpRequest): HttpResponse;
    transport: Transport;
    seed(fields: Partial<FakeEntry> & { start: number }): FakeEntry;
}

export const FAKE_API_KEY = "test-key";

function iso(ms: number): string {
    return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

function durationIso(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

function json(status: number, value?: unknown): HttpResponse {
    return { status, body: value === undefined ? "" : JSON.stringify(value) };
}

function error(status: number, message: string): HttpResponse {
    return json(status, { message, code: status });
}

function parseUrl(url: string): { path: string; query: Record<string, string> } {
    const match = /^(?:[a-z]+:\/\/[^/]+)?([^?]*)(?:\?(.*))?$/i.exec(url);
    let path = match?.[1] ?? url;
    const query: Record<string, string> = {};
    for (const pair of (match?.[2] ?? "").split("&")) {
        if (!pair) continue;
        const [k = "", v = ""] = pair.split("=");
        query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    path = path.replace(/^\/api\/v1/, "");
    return { path, query };
}

export function createClockifyFake(options: { apiKey?: string } = {}): ClockifyFake {
    let seq = 0;
    const state: FakeState = {
        apiKey: options.apiKey ?? FAKE_API_KEY,
        user: { id: "user-1", name: "Test User", email: "user@example.com", activeWorkspace: "ws-1", defaultWorkspace: "ws-1" },
        workspaces: [
            {
                id: "ws-1",
                name: "Main",
                workspaceSettings: { forceProjects: false, forceTasks: false, forceDescription: false, forceTags: false }
            },
            {
                id: "ws-2",
                name: "Side",
                workspaceSettings: { forceProjects: true, forceTasks: false, forceDescription: false, forceTags: false }
            }
        ],
        projects: {
            "ws-1": [
                { id: "p-web", name: "Website", color: "#03A9F4", clientName: "Acme", archived: false, billable: true },
                { id: "p-int", name: "Internal", color: "#8BC34A", clientName: "", archived: false, billable: false },
                { id: "p-old", name: "Legacy", color: "#9E9E9E", clientName: "", archived: true, billable: false }
            ],
            "ws-2": [{ id: "p-side", name: "Side project", color: "#FF5722", clientName: "", archived: false, billable: false }]
        },
        tasks: {
            "p-web": [
                { id: "t-dev", name: "Development", projectId: "p-web", status: "ACTIVE" },
                { id: "t-design", name: "Design", projectId: "p-web", status: "ACTIVE" }
            ]
        },
        tags: {
            "ws-1": [
                { id: "tag-rev", name: "review", archived: false },
                { id: "tag-meet", name: "meeting", archived: false }
            ],
            "ws-2": []
        },
        entries: [],
        requests: [],
        failNext: null,
        offline: false
    };

    // Runs inside QML too: no Array.prototype.flat/flatMap there (V4 engine).
    const allProjects = () => Object.keys(state.projects).reduce<FakeProject[]>((all, ws) => all.concat(state.projects[ws] ?? []), []);

    function render(e: FakeEntry, hydrated: boolean) {
        const out: Record<string, unknown> = {
            id: e.id,
            description: e.description,
            projectId: e.projectId,
            taskId: e.taskId,
            tagIds: [...e.tagIds],
            billable: e.billable,
            userId: e.userId,
            workspaceId: e.workspaceId,
            timeInterval: {
                start: iso(e.start),
                end: e.end === null ? null : iso(e.end),
                duration: e.end === null ? null : durationIso(Math.round((e.end - e.start) / 1000))
            }
        };
        if (hydrated) {
            const p = allProjects().find(x => x.id === e.projectId);
            out.project = p ? { id: p.id, name: p.name, color: p.color, clientName: p.clientName } : null;
            const t = (state.tasks[e.projectId ?? ""] ?? []).find(x => x.id === e.taskId);
            out.task = t ? { id: t.id, name: t.name } : null;
            const wsTags = state.tags[e.workspaceId] ?? [];
            out.tags = wsTags.filter(x => e.tagIds.indexOf(x.id) !== -1).map(x => ({ id: x.id, name: x.name }));
        }
        return out;
    }

    function paginate<T>(list: T[], query: Record<string, string>): T[] {
        const page = Number(query.page ?? 1);
        const size = Number(query["page-size"] ?? 50);
        return list.slice((page - 1) * size, page * size);
    }

    const runningFor = (ws: string, uid: string) =>
        state.entries.find(e => e.workspaceId === ws && e.userId === uid && e.end === null) ?? null;

    interface Body {
        start?: string;
        end?: string;
        description?: string;
        projectId?: string | null;
        taskId?: string | null;
        tagIds?: string[];
        billable?: boolean;
    }

    function bodyProblem(body: Body | null): string {
        if (!body?.start || Number.isNaN(Date.parse(body.start))) return "start is required";
        if (body.end && Date.parse(body.end) < Date.parse(body.start)) return "end must be after start";
        return "";
    }

    function applyBody(entry: FakeEntry, body: Body): void {
        entry.description = body.description ?? "";
        entry.projectId = body.projectId || null;
        entry.taskId = body.taskId || null;
        entry.tagIds = [...(body.tagIds ?? [])];
        entry.billable = !!body.billable;
        entry.start = Date.parse(body.start ?? "");
        entry.end = body.end ? Date.parse(body.end) : null;
    }

    function handle(request: HttpRequest): HttpResponse {
        if (state.offline) return { status: 0, body: "" };
        const { path, query } = parseUrl(request.url);
        const method = request.method.toUpperCase();
        let body: Body | null = null;
        if (request.body) {
            try {
                body = JSON.parse(request.body) as Body;
            } catch {
                return error(400, "Malformed JSON");
            }
        }
        state.requests.push({ method, path, query, body });

        if (state.failNext) {
            const f = state.failNext;
            state.failNext = null;
            return error(f.status, f.message);
        }
        const key = request.headers["X-Api-Key"] ?? request.headers["x-api-key"];
        if (key !== state.apiKey) return error(401, "Full authentication is required to access this resource");

        // Route table: each pattern is matched once up front.
        const projectsRoute = /^\/workspaces\/([^/]+)\/projects$/.exec(path);
        const tasksRoute = /^\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks$/.exec(path);
        const tagsRoute = /^\/workspaces\/([^/]+)\/tags$/.exec(path);
        const userEntriesRoute = /^\/workspaces\/([^/]+)\/user\/([^/]+)\/time-entries$/.exec(path);
        const entriesRoute = /^\/workspaces\/([^/]+)\/time-entries$/.exec(path);
        const entryRoute = /^\/workspaces\/([^/]+)\/time-entries\/([^/]+)$/.exec(path);
        if (method === "GET" && path === "/user") return json(200, state.user);
        if (method === "GET" && path === "/workspaces") return json(200, state.workspaces);

        if (method === "GET" && projectsRoute) {
            const list = (state.projects[projectsRoute[1] ?? ""] ?? []).filter(p => (query.archived === "false" ? !p.archived : true));
            return json(200, paginate(list, query));
        }
        if (method === "GET" && tasksRoute) return json(200, paginate(state.tasks[tasksRoute[2] ?? ""] ?? [], query));
        if (method === "GET" && tagsRoute) return json(200, paginate(state.tags[tagsRoute[1] ?? ""] ?? [], query));

        if (userEntriesRoute) {
            const ws = userEntriesRoute[1] ?? "";
            const uid = userEntriesRoute[2] ?? "";
            if (method === "GET") {
                let list = state.entries.filter(e => e.workspaceId === ws && e.userId === uid);
                if (query["in-progress"] === "true") list = list.filter(e => e.end === null);
                if (query.start) {
                    const from = Date.parse(query.start);
                    list = list.filter(e => e.start >= from);
                }
                if (query.end) {
                    const to = Date.parse(query.end);
                    list = list.filter(e => e.start <= to);
                }
                list.sort((a, b) => b.start - a.start);
                const hydrated = query.hydrated === "true";
                return json(
                    200,
                    paginate(list, query).map(e => render(e, hydrated))
                );
            }
            if (method === "PATCH") {
                const running = runningFor(ws, uid);
                if (!running) return error(404, "No running time entry");
                if (!body?.end) return error(400, "end is required");
                running.end = Date.parse(body.end);
                return json(200, render(running, false));
            }
        }

        if (method === "POST" && entriesRoute) {
            const problem = bodyProblem(body);
            if (problem || !body) return error(400, problem);
            const ws = entriesRoute[1] ?? "";
            if (!body.end) {
                // Clockify stops a running timer when a new one starts.
                const current = runningFor(ws, state.user.id);
                if (current) current.end = Date.parse(body.start ?? "");
            }
            seq++;
            const entry: FakeEntry = {
                id: `e-${seq}`,
                workspaceId: ws,
                userId: state.user.id,
                description: "",
                projectId: null,
                taskId: null,
                tagIds: [],
                billable: false,
                start: 0,
                end: null
            };
            applyBody(entry, body);
            state.entries.push(entry);
            return json(201, render(entry, false));
        }

        if (entryRoute) {
            const ws = entryRoute[1];
            const id = entryRoute[2];
            const target = state.entries.find(e => e.id === id && e.workspaceId === ws);
            if (!target) return error(404, "Time entry not found");
            if (method === "PUT") {
                const problem = bodyProblem(body);
                if (problem || !body) return error(400, problem);
                applyBody(target, body);
                return json(200, render(target, false));
            }
            if (method === "DELETE") {
                state.entries = state.entries.filter(e => e !== target);
                return { status: 204, body: "" };
            }
        }
        return error(404, `No route for ${method} ${path}`);
    }

    function seed(fields: Partial<FakeEntry> & { start: number }): FakeEntry {
        seq++;
        const entry: FakeEntry = {
            id: fields.id ?? `e-${seq}`,
            workspaceId: fields.workspaceId ?? "ws-1",
            userId: state.user.id,
            description: fields.description ?? "",
            projectId: fields.projectId ?? null,
            taskId: fields.taskId ?? null,
            tagIds: fields.tagIds ?? [],
            billable: fields.billable ?? false,
            start: fields.start,
            end: fields.end === undefined ? null : fields.end
        };
        state.entries.push(entry);
        return entry;
    }

    return {
        state,
        handle,
        transport: request => Promise.resolve(handle(request)),
        seed
    };
}
