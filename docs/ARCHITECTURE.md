# Architecture

```
plugin.json                 composite plugin: daemon + bar widget + settings
TimeTrackerDaemon.qml       single instance: owns TrackerService, IPC, toasts
TimeTrackerWidget.qml       per bar/screen: pill, popout, Control Center tile
TimeTrackerSettings.qml     Settings → Plugins → Time Tracker
ui/                         popout components (TimerCard, EntryRow, EntryEditor, TrackerPanel, Texts)
lib/TrackerService.qml      QML wrapper around the store (QtQuick only, unit-testable)
lib/tracker.mjs             GENERATED bundle of src/ (committed; shipped to users)
src/core/                   provider-neutral domain: types, time, entries, http, store
src/providers/              one directory per service + registry.ts
src/qml/                    bundle entry point and the XMLHttpRequest transport
translations/               ru.json, uk.json (DMS plugin catalog format)
tests/                      unit, contract, fakes, QML and HTTP integration tests
scripts/                    build, lint, format, i18n, manifest, QML tooling environment
```

## Layers

```
 ┌──────────── QML (DMS) ─────────────┐
 │ Widget ×N   Settings   Daemon ×1   │   bind to service.snapshot, call service.start() …
 └──────────────┬─────────────────────┘
                │ PluginService global var "service"
 ┌──────────────▼─────────────────────┐
 │ lib/TrackerService.qml             │   reactive snapshot, 1 s tick, poll timer
 └──────────────┬─────────────────────┘
                │ import "tracker.mjs"
 ┌──────────────▼─────────────────────┐
 │ TrackerStore (src/core/store.ts)   │   state + actions, provider-neutral, no timers
 └──────────────┬─────────────────────┘
                │ TrackerProvider interface
 ┌──────────────▼─────────────────────┐
 │ ClockifyProvider (src/providers)   │   REST mapping
 └──────────────┬─────────────────────┘
                │ Transport (request → Promise<{status, body}>)
       XMLHttpRequest in the shell · in-memory fake in tests · HTTP mock in integration tests
```

### Store

`TrackerStore` holds the whole state and exposes actions (`start`, `stop`, `updateRunning`,
`createEntry`, `updateEntry`, `deleteEntry`, `continueEntry`, `duplicateEntry`, `refresh`, …).

- Every action returns `Promise<{ok, code, error}>` and never rejects; `code` is a stable
  identifier (`missing-project`, `auth`, `network`, …) that the UI translates.
- After each change it emits an immutable `StoreState` snapshot. QML binds to it; replacing the
  snapshot is what makes bindings update.
- It owns no timers. The QML wrapper ticks the clock and calls `refresh()` periodically, which
  keeps the store deterministic in tests.
- Loads are tagged with a generation number; results from an outdated load (settings changed
  mid-flight) are dropped. A periodic refresh is skipped while a mutation is in flight and does
  not emit when nothing changed, so lists keep their scroll position.

### Requests, caching and rate limits

- Catalogues (user, workspaces, projects, tags, loaded tasks) are cached per account for 15
  minutes (`CATALOGUE_TTL_MS`). Switching to an account that was loaded recently costs two
  requests (running timer + history). *Reconnect* and error recovery bypass the cache.
- Every request goes through `withRetry` (`src/core/retry.ts`): at most four in flight, and
  `429 Too Many Requests` is retried after 0.5 s, 1 s and 2 s. The delays come from a QML `Timer`
  (`TrackerService._delay`) because V4 has no `setTimeout`.
- `TrackerService` applies plugin-data changes with a 300 ms debounce, so several saves in a row
  (an account switch, typing in settings) trigger one reload.

### Providers

See [PROVIDERS.md](PROVIDERS.md). A provider declares capabilities (tasks, tags, billable,
required fields, …) and its settings fields; the UI and validation adapt to them.

### Sharing state between surfaces

DMS instantiates the bar widget once per bar and screen, the daemon once. The daemon creates the
only `TrackerService` and publishes it with `PluginService.setGlobalVar(pluginId, "service", …)`.
Widgets and the settings page read it from `PluginService.globalVars`, so there is one network
client, one poll timer and one source of truth.

### Settings storage

Plugin data (stored by DMS in `~/.config/dms/plugin_settings.json` under `timeTracker`) keys:

| Key | Meaning |
|---|---|
| `accounts` | list of accounts: `{id, name, provider, settings: {apiKey, baseUrl, …}, workspaceId, defaultProjectId, defaultTaskId, defaultBillable}` (`defaultBillable` is also saved when the billable button is toggled) |
| `activeAccount` | id of the account in use |
| `provider`, `<provider>.<field>`, `workspaceId`, … | pre-accounts layout; read as one account until `accounts` is first saved (`src/core/accounts.ts`) |
| `pollInterval`, `historyDays`, `weekStart` | sync and history |
| `showDescription`, `showProject`, `showTodayWhenIdle`, `barLabelWidth` | bar display (`showTodayWhenIdle` also covers the Control Center tile) |
| `showTotalsInPopout`, `timerShowProject`, `timerShowTags`, `timerShowBillable` | popout display |

## QML engine constraints

The TypeScript runs inside Qt's V4 JavaScript engine, not Node. Verified on Qt 6.11:

| Not available in V4 | Use instead |
|---|---|
| `async` / `await` (no native support; lowered generators **crash V4** on resume) | promise chains (`.then`) |
| `Promise.prototype.finally`, `Promise.allSettled` | `.then(onOk, onErr)` |
| `Array.prototype.flat`, `flatMap`, `at`, `findLast` | `reduce`/`concat`, index access |
| `Object.fromEntries`, `String.prototype.replaceAll`, `trimEnd` | loops, regex `replace` |
| `globalThis` in ES modules | the global name directly (`XMLHttpRequest`) |
| Arrays read from QML `var` properties may be `V4Sequence` objects (`Array.isArray` is false) | `toArray()` from `src/core/arrays.ts` on every array coming from QML |

Enforced in two places:

1. `tsconfig.json` compiles `src/` against `lib: es2017` without DOM/Node types, so most missing
   APIs are type errors.
2. `scripts/build.mjs` scans the bundle and fails on anything from the table, including
   generators.

Tests (`tests/`) run on Node and may use modern JavaScript freely — except `tests/fakes/`, which
is bundled into the QML tests.

The bundle is ES2016 syntax (esbuild `target: es2016`). esbuild's trailing `export { … }` list is
rewritten into inline `export function …` declarations, because qmllint/qmlls only recognise the
latter.

## Tooling for QML

Quickshell maps `import qs.Common` to the shell's `Common/` directory at runtime and synthesises
`qmldir` files. `scripts/qml-env.ts` reproduces that for static tools: it mirrors the DMS sources
into `.qml-env/qs/**` with generated `qmldir` files and writes `.qmlls.ini`, so qmllint and
editors (Zed, VS Code, Qt Creator via qmlls) resolve `qs.*` and `Quickshell` types. `nix develop`
runs it automatically; otherwise `npm run qml:env`.
