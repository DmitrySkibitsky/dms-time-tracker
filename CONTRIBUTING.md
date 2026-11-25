# Contributing

## Toolchain

The easiest way is Nix:

```bash
nix develop        # Node 24, Qt tools (qmllint, qmlformat, qmltestrunner), DMS + Quickshell paths
npm ci             # TypeScript, esbuild, Biome
```

Without Nix you need Node ≥ 22.18 (runs `.ts` natively), Qt 6 `qtdeclarative` tools and a DMS
installation; set `DMS_SHELL_DIR` (the directory with DMS's `shell.qml`) and `QUICKSHELL_QML_DIR`
(Quickshell's `lib/qt-6/qml`) if they aren't detected.

`npm ci` also points git at `.githooks` (pre-commit and pre-push hooks).

## Layout

Logic lives in TypeScript under `src/`; QML is UI only. `lib/tracker.mjs` is generated from
`src/` and **committed**, because DMS installs plugins straight from git. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), especially the QML engine constraints — the code
runs in Qt's V4 engine, which lacks `async/await` and several modern built-ins.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | bundle `src/` → `lib/tracker.mjs` (fails on APIs the QML engine lacks) |
| `npm run typecheck` | `tsc` for `src/` (ES2017 lib) and for tests/scripts (Node) |
| `npm run lint` | Biome (TS/JSON) + qmllint against the real DMS/Quickshell modules |
| `npm run format` | Biome + qmlformat, in place |
| `npm run format:check` | the same, check only |
| `npm run test:unit` | unit and provider-contract tests (Node test runner) |
| `npm run test:qml` | QML tests with qmltestrunner, incl. real HTTP through `XMLHttpRequest` |
| `npm test` | both test suites |
| `npm run i18n:check` / `i18n:sync` | verify / update `translations/*.json` |
| `npm run check:manifest` | validate `plugin.json` |
| `npm run changelog` | bump the version (`package.json` + `plugin.json`) and add a `CHANGELOG.md` section; see Releases |
| `npm run check` | everything CI runs |
| `nix flake check` | tests, QML lint/format, i18n and manifest in the Nix sandbox |

## Trying changes in a running DMS

```bash
ln -s "$PWD" ~/.config/dms/plugins/timeTracker
dms ipc call plugins enable timeTracker
dms ipc call plugins reload timeTracker   # after editing
```

`reload` is enough for changes inside the plugin's top-level QML files only. Qt caches per shell
process both the QML types of `ui/` and `lib/` components and ES modules: after changing a
component's properties or signals (or adding a file) reload fails with "Cannot assign to
non-existent property", and after rebuilding `lib/tracker.mjs` the module may resolve to an error
object ("Property 'x' of object TypeError"). Run `dms restart` in those cases. Logs: `/run/user/$UID/quickshell/by-id/*/log.log`.

## Git hooks

- **pre-commit**: Biome on staged files, typecheck, qmlformat + qmllint (when QML is staged),
  translations, manifest, and a rebuilt bundle must match the committed `lib/tracker.mjs`.
- **pre-push**: unit/contract tests and QML tests.

## Tests

- `tests/unit/` — pure logic, the Clockify adapter, the store (with a controllable clock).
- `tests/contract/` — the behaviour every provider must have; one harness per provider.
- `tests/fakes/` — in-memory service fakes, also bundled for QML tests.
- `tests/qml/` — `TrackerService` and the bundle inside the real QML engine.
- `tests/integration/mockServer.ts` — HTTP front for the fake, used by `tst_http.qml`.

Tests run with `TZ=UTC`.

## Translations

UI strings are wrapped as `I18n.trFor("timeTracker", "English text")` — the plugin id must be a
literal. After adding or changing strings run `npm run i18n:sync`, translate the new (empty)
entries in `translations/*.json`; `npm run i18n:check` (also in CI) rejects missing, empty or
obsolete entries and mismatched `%1` placeholders. A new language is a new
`translations/<locale>.json` (`{}` is enough, then sync).

## Workflow

- Every change goes through a branch and a pull request; nobody commits or pushes to `main`
  directly. Branch names follow the commit type: `feat/…`, `fix/…`, `ci/…`, `docs/…`.
- Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <short description>`, e.g. `fix(timer): keep the start time when editing the
  description`. Formatting-only changes go in their own `style:` commit.
- One concern per pull request. Every commit should make sense on its own: pull requests are
  usually merged with **Rebase**, which keeps them; a branch with fix-up commits is squashed.
- `main` is protected by two rulesets: a pull request gets in only when the **CI result** check
  passed (linear history, no force pushes or deletion), and only the owner merges.
- CI (`.github/workflows/ci.yml`): `Changes` decides whether anything besides `docs/`, Markdown
  and `LICENSE` changed; if so, the TypeScript and QML (`nix flake check`) jobs run. `CI result`
  passes when every job passed or was skipped for a documentation-only change; it is the single
  required check.
- Git hooks (`.githooks`) run the fast checks on commit and the tests on push. Never bypass them
  with `--no-verify`; fix the cause.
- Workflow actions are pinned to commit SHAs; Dependabot keeps the pins current.

## Pull requests

Opening a pull request fills in [the template](.github/pull_request_template.md). Keep its
sections, and fill in **AI assistance** every time:

- whether an AI tool wrote or changed any part of the pull request (code, tests, docs, the
  description itself);
- if so, the tool and the exact model (e.g. Claude Code, `claude-opus-5-5`), and what it did.

No "Generated with …" lines or AI co-author trailers in commits or descriptions: the AI section
says it once, in a form every pull request shares.

## Releases

Versions follow [Semantic Versioning](https://semver.org/). DMS installs and updates plugins by git
revision, so a version is for people: the badge in the DMS plugin manager, `CHANGELOG.md`, release
archives, Nix/Home Manager users pinning `?ref=vX.Y.Z`, bug reports. Before 1.0 a breaking change
(settings that need a migration, a removed IPC command, a higher `requires_dms`) is a minor release;
features and fixes are patch releases.

`CHANGELOG.md` is generated by [changelogen](https://github.com/unjs/changelogen) from the commit
messages; `changelog.config.ts` keeps what plugin users notice (`feat`, `fix`, `perf`). `main` takes
no direct pushes, so the release commit goes through a pull request like any other change.

Prepare the release on a branch from an up-to-date `main`:

```bash
git switch -c chore/release-v0.2.0
npm run changelog                  # version from the commits since the last tag
npm run changelog -- -r 0.2.0      # or name it (the first release: -r 0.1.0)
```

It writes the version to `package.json`, copies it to `plugin.json` (`scripts/sync-version.ts`) and
adds a section on top of `CHANGELOG.md`. Before 1.0, changelogen turns a `feat` into a patch
release: name a minor one with `-r`. Read the section and drop what users don't need (scopes are
not filtered), then commit it as `chore(release): v0.2.0` and open a pull request.

After the merge, tag the merged commit and push the tag:

```bash
git switch main && git pull --ff-only
git tag -a v0.2.0 -m v0.2.0
git push origin v0.2.0
```

The tag starts `.github/workflows/release.yml`:

| Job              | Steps |
|------------------|-------|
| `build`          | the tag matches `plugin.json` and `package.json` and is on `main`, **CI result** passed on that commit, `CHANGELOG.md` has the version's section; pack `timeTracker-vX.Y.Z.zip` (no write access in this job) |
| `github-release` | a GitHub release with the changelog section and the archive; versions with a suffix (`0.3.0-beta.1`) become prereleases |

A failed run is re-run from the Actions tab; the tag stays.
