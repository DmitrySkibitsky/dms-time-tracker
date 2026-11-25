// Accounts: several sets of credentials (e.g. a personal and a work Clockify), one active at a
// time. Stored in plugin data as `accounts` (array) + `activeAccount` (id). Pure functions over
// the plugin data object so the settings screen, the daemon and tests share one implementation.

import { toArray } from "./arrays.ts";
import type { ProviderDescriptor, ProviderSettings } from "./types.ts";

export interface Account {
    id: string;
    /** User-visible label, e.g. "Work". */
    name: string;
    /** ProviderDescriptor.id */
    provider: string;
    /** Provider settings keyed by SettingField.key. */
    settings: ProviderSettings;
    workspaceId: string;
    defaultProjectId: string;
    defaultTaskId: string;
    defaultBillable: boolean;
}

/** Account fields the UI may change. */
export type AccountPatch = Partial<Omit<Account, "id" | "settings">> & { settings?: ProviderSettings };

type PluginData = Record<string, unknown> | null | undefined;

const LEGACY_ID = "default";

function str(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function bool(value: unknown): boolean {
    return value === true || value === "true";
}

/** Fills missing provider settings with their defaults. */
export function withSettingDefaults(settings: ProviderSettings, descriptor: ProviderDescriptor | null): ProviderSettings {
    const out: ProviderSettings = {};
    for (const key of Object.keys(settings)) out[key] = settings[key] ?? "";
    if (descriptor) {
        for (const field of descriptor.settings) {
            const value = out[field.key];
            if (value === undefined || value === "") out[field.key] = field.defaultValue;
        }
    }
    return out;
}

function sanitize(raw: unknown, index: number): Account | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const settings: ProviderSettings = {};
    if (r.settings && typeof r.settings === "object") {
        for (const [key, value] of Object.entries(r.settings as Record<string, unknown>)) {
            if (typeof value === "string") settings[key] = value;
        }
    }
    return {
        id: str(r.id) || `account-${index + 1}`,
        name: str(r.name) || `Account ${index + 1}`,
        provider: str(r.provider),
        settings,
        workspaceId: str(r.workspaceId),
        defaultProjectId: str(r.defaultProjectId),
        defaultTaskId: str(r.defaultTaskId),
        defaultBillable: bool(r.defaultBillable)
    };
}

/**
 * Builds the single account of the pre-accounts settings layout (`provider`,
 * `<provider>.<key>`, `workspaceId`, …). Empty settings when nothing was configured.
 */
export function legacyAccount(data: PluginData, defaultProvider: string, providerName: string, settingKeys: string[]): Account {
    const provider = str(data?.provider) || defaultProvider;
    const settings: ProviderSettings = {};
    for (const key of settingKeys) {
        const value = str(data?.[`${provider}.${key}`]);
        if (value) settings[key] = value;
    }
    return {
        id: LEGACY_ID,
        name: providerName,
        provider,
        settings,
        workspaceId: str(data?.workspaceId),
        defaultProjectId: str(data?.defaultProjectId),
        defaultTaskId: str(data?.defaultTaskId),
        defaultBillable: bool(data?.defaultBillable)
    };
}

export interface AccountContext {
    providers: readonly ProviderDescriptor[];
    defaultProvider: string;
}

/** The configured accounts; the legacy single-account layout is migrated on the fly. */
export function listAccounts(data: PluginData, ctx: AccountContext): Account[] {
    const stored = toArray(data?.accounts);
    const accounts = stored.map(sanitize).filter((a): a is Account => a !== null);
    const seen = new Set<string>();
    const unique = accounts.filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
    });
    for (const a of unique) {
        if (!ctx.providers.some(p => p.id === a.provider)) a.provider = ctx.defaultProvider;
    }
    if (unique.length > 0) return unique;
    const provider = str(data?.provider) || ctx.defaultProvider;
    const descriptor = ctx.providers.find(p => p.id === provider) ?? null;
    return [legacyAccount(data, ctx.defaultProvider, descriptor?.name ?? provider, descriptor?.settings.map(s => s.key) ?? [])];
}

export function activeAccountId(data: PluginData, accounts: readonly Account[]): string {
    const wanted = str(data?.activeAccount);
    return accounts.some(a => a.id === wanted) ? wanted : (accounts[0]?.id ?? "");
}

export function findActiveAccount(data: PluginData, ctx: AccountContext): Account {
    const accounts = listAccounts(data, ctx);
    const id = activeAccountId(data, accounts);
    return accounts.find(a => a.id === id) ?? (accounts[0] as Account);
}

/** Returns the account list with one account changed (settings are merged, not replaced). */
export function patchAccount(accounts: readonly Account[], id: string, patch: AccountPatch): Account[] {
    return accounts.map(a => {
        if (a.id !== id) return a;
        const next: Account = { ...a, ...patch, id: a.id, settings: { ...a.settings, ...(patch.settings ?? {}) } };
        // Credentials of one service mean nothing to another one.
        if (patch.provider !== undefined && patch.provider !== a.provider && patch.settings === undefined) next.settings = {};
        // Workspace-bound defaults don't survive a change of service or credentials.
        if (patch.provider !== undefined && patch.provider !== a.provider) {
            next.workspaceId = "";
            next.defaultProjectId = "";
            next.defaultTaskId = "";
        }
        return next;
    });
}

/** Creates an account with a unique id and a "<Service> N" name. */
export function newAccount(accounts: readonly Account[], provider: ProviderDescriptor, now: number): Account {
    let n = accounts.filter(a => a.provider === provider.id).length + 1;
    const names = new Set(accounts.map(a => a.name));
    let name = n === 1 ? provider.name : `${provider.name} ${n}`;
    while (names.has(name)) {
        n++;
        name = `${provider.name} ${n}`;
    }
    let id = `acc-${now.toString(36)}`;
    let suffix = 0;
    while (accounts.some(a => a.id === id)) id = `acc-${now.toString(36)}-${++suffix}`;
    return {
        id,
        name,
        provider: provider.id,
        settings: {},
        workspaceId: "",
        defaultProjectId: "",
        defaultTaskId: "",
        defaultBillable: false
    };
}

export function removeAccount(accounts: readonly Account[], id: string): Account[] {
    return accounts.filter(a => a.id !== id);
}
