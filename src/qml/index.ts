// Entry point bundled into lib/tracker.mjs and imported by the QML components:
//   import "lib/tracker.mjs" as Tracker

import {
    type Account,
    type AccountPatch,
    findActiveAccount,
    listAccounts,
    newAccount,
    patchAccount,
    removeAccount,
    withSettingDefaults
} from "../core/accounts.ts";
import { type Delay, withRetry } from "../core/retry.ts";
import { DEFAULT_CONFIG, liveTotal, type StoreOptions, type StoreState, TrackerStore } from "../core/store.ts";
import { addDays } from "../core/time.ts";
import type { EntryDraft } from "../core/types.ts";
import { DEFAULT_PROVIDER_ID, findProvider, providers } from "../providers/registry.ts";
import { createXhrTransport } from "./xhrTransport.ts";

export {
    applyPatch,
    draftFromEntry,
    emptyDraft,
    projectLabel,
    projectOptions,
    recentSuggestions,
    taskOptions,
    validateDraft
} from "../core/entries.ts";
export {
    dayKey,
    formatClock,
    formatDuration,
    parseClock,
    parseDurationInput,
    resolveRange,
    startOfDay
} from "../core/time.ts";
export { addDays, createXhrTransport, DEFAULT_CONFIG, DEFAULT_PROVIDER_ID, findProvider, liveTotal, providers, TrackerStore };

/** Plugin id from plugin.json; also the IPC target and settings namespace. */
export const PLUGIN_ID = "timeTracker";

type PluginData = Record<string, unknown> | null | undefined;

const accountContext = { providers, defaultProvider: DEFAULT_PROVIDER_ID };

function num(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) && value !== "" && value !== null && value !== undefined ? n : fallback;
}

/** Configured accounts (the pre-accounts settings layout becomes one account). */
export function accounts(pluginData: PluginData): Account[] {
    return listAccounts(pluginData, accountContext);
}

/** The account the tracker currently works with. */
export function activeAccount(pluginData: PluginData): Account {
    return findActiveAccount(pluginData, accountContext);
}

/** Builds the store configuration from the plugin data saved by the settings screen. */
export function configFromPluginData(pluginData: PluginData) {
    const account = activeAccount(pluginData);
    return {
        accountId: account.id,
        providerId: account.provider,
        settings: withSettingDefaults(account.settings, findProvider(account.provider)),
        workspaceId: account.workspaceId,
        defaultProjectId: account.defaultProjectId,
        defaultTaskId: account.defaultTaskId,
        defaultBillable: account.defaultBillable,
        historyDays: num(pluginData?.historyDays, DEFAULT_CONFIG.historyDays),
        weekStart: num(pluginData?.weekStart, DEFAULT_CONFIG.weekStart)
    };
}

// The functions below return the new `accounts` list for the caller to save as plugin data.

export function updateActiveAccount(pluginData: PluginData, patch: AccountPatch): Account[] {
    return patchAccount(accounts(pluginData), activeAccount(pluginData).id, patch);
}

export function addAccount(pluginData: PluginData, providerId: string, now: number): { accounts: Account[]; id: string } {
    const list = accounts(pluginData);
    const descriptor = findProvider(providerId) ?? findProvider(DEFAULT_PROVIDER_ID);
    if (!descriptor) return { accounts: list, id: activeAccount(pluginData).id };
    const created = newAccount(list, descriptor, now);
    return { accounts: [...list, created], id: created.id };
}

/** Removes an account; the last remaining account can't be removed. */
export function deleteAccount(pluginData: PluginData, id: string): { accounts: Account[]; activeId: string } {
    const list = accounts(pluginData);
    const active = activeAccount(pluginData).id;
    if (list.length <= 1) return { accounts: list, activeId: active };
    const next = removeAccount(list, id);
    return { accounts: next, activeId: id === active ? (next[0] as Account).id : active };
}

/**
 * Creates a store wired to the QML XMLHttpRequest. Requests go through withRetry: at most four
 * at once, and "429 Too Many Requests" is retried with back-off using `delay` (a QML Timer;
 * without it 429s are reported as errors).
 */
export function createStore(
    options: Omit<StoreOptions, "providers" | "transport"> & Partial<Pick<StoreOptions, "transport">> & { delay?: Delay }
): TrackerStore {
    const { delay, transport, ...rest } = options;
    return new TrackerStore({ ...rest, providers, transport: withRetry(transport ?? createXhrTransport(), { delay }) });
}

/** Today's total including the running timer. */
export function todayTotal(state: StoreState, now: number): number {
    return liveTotal(state, state.todayFinished, state.dayStart, addDays(state.dayStart, 1), now);
}

/** This week's total including the running timer. */
export function weekTotal(state: StoreState, now: number): number {
    return liveTotal(state, state.weekFinished, state.weekStartMs, now + 1, now);
}

/** Running timer's elapsed seconds. */
export function elapsed(state: StoreState, now: number): number {
    return state.running ? Math.max(0, Math.floor((now - state.running.start) / 1000)) : 0;
}

/** Copy of a draft safe to mutate from QML. */
export function cloneDraft(draft: EntryDraft): EntryDraft {
    return { ...draft, tagIds: [...draft.tagIds] };
}
