# Adding a provider

A provider adapts one time tracking service to the plugin's domain model
(`src/core/types.ts`). The store, the UI and the settings screen only talk to the
`TrackerProvider` interface.

## 1. Implement the adapter

Create `src/providers/<id>/` with:

- `wire.ts` — the service's request/response shapes and mapping to `TimeEntry`, `Project`, …
- `provider.ts` — a class implementing `TrackerProvider` plus a `ProviderDescriptor`.

```ts
export const myDescriptor: ProviderDescriptor = {
    id: "toggl",
    name: "Toggl Track",
    icon: "timer",
    homepage: "https://toggl.com/track",
    capabilities: {
        workspaces: true, projects: true, tasks: false, tags: true, billable: true,
        projectColors: true, requiresProject: false, requiresTask: false, editRunningEntry: true
    },
    settings: [
        { key: "apiToken", label: "API token", description: "…", kind: "secret",
          placeholder: "", defaultValue: "", required: true }
    ],
    create: context => new TogglProvider(context)
};
```

Rules:

- Use `JsonClient` from `src/core/http.ts` with `context.transport`; never create
  `XMLHttpRequest` yourself. Errors must be `TrackerError` with a meaningful `kind`
  (`auth`, `not-found`, `validation`, `network`, …) — `JsonClient` maps HTTP statuses for you.
- Times are epoch milliseconds; a running entry has `end: null`.
- If the service has no workspaces, return one synthetic workspace.
- Express service-specific rules through `capabilities` (`requiresTask` for Harvest-style
  services) or per-workspace `requirements`.
- Follow the [QML engine constraints](ARCHITECTURE.md#qml-engine-constraints): promise chains,
  no `async`/`await`.
- Provider setting `label`/`description` strings are translated: run `npm run i18n:sync` and fill
  in `translations/*.json`.

## 2. Register it

Add the descriptor to `providers` in `src/providers/registry.ts`. The settings screen lists it in
the *Service* dropdown and renders its fields; values are stored as `<id>.<key>`.

## 3. Test it

1. Write an in-memory fake of the service in `tests/fakes/` (see `clockifyFake.ts`).
2. Run the shared contract suite against it — this is what guarantees the store and UI work:

   ```ts
   // tests/contract/toggl.contract.test.ts
   runProviderContract(togglDescriptor, () => {
       const fake = createTogglFake();
       return {
           provider: togglDescriptor.create({ settings: { apiToken: TOKEN }, transport: fake.transport }),
           unauthorized: togglDescriptor.create({ settings: { apiToken: "bad" }, transport: fake.transport }),
           workspaceId: "…", projectId: "…",
           seed: entry => fake.seed(entry).id,
           goOffline: () => { fake.state.offline = true; }
       };
   });
   ```
3. Add provider-specific unit tests for mapping and request shapes.

## 4. Build

`npm run build` regenerates `lib/tracker.mjs`; commit it with the sources.
