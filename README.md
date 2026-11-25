# Time Tracker for DMS

A time tracking plugin for [DMS (Dux Modular Shell)](https://github.com/AvengeMedia/DankMaterialShell).
Start and stop timers from the bar, pick a project, task and tags, fix entries, add time you
forgot to track — without leaving the desktop.

Works with **Clockify** today. Services are plugged in through adapters, so other trackers
(Toggl Track, Harvest, Kimai, …) can be added without touching the UI — see
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## Features

- **Bar widget** — running time, description and project; today's total when idle. Right click
  starts/stops the timer. Horizontal and vertical bars, docks.
- **Timer** — description with suggestions from recent entries, project (fuzzy search), task,
  tags (searchable picker, made for long tag lists), billable flag — remembered for the next
  timers. Each of the project / tags / billable fields can be hidden. Edit everything while the timer runs, including its start time. Discard a
  timer you started by mistake.
- **History** — entries grouped by day with daily totals, today/this-week totals in the header.
  Continue an entry with one click, edit, duplicate or delete it.
- **Manual time** — add an entry with date, start/end or duration (`1:30`, `90m`, `1.5h`);
  overnight ranges are handled.
- **Several accounts** — e.g. a personal and a work Clockify: add them in the settings, switch
  from the popout header (or IPC). Each keeps its own credentials, workspace, default project and
  billable default.
- **Workspace rules** — Clockify's "force project / task / description / tags" settings are
  enforced before saving, with a clear message.
- **Settings** — service and credentials, workspace, default project and task, billable by
  default, sync interval, history length, first day of the week, bar display options, which timer
  fields to show. Daily/weekly totals can be hidden everywhere (handy for screen recordings).
- **Control Center tile** — status and a start/stop toggle.
- **IPC** — script it or bind keys: see [Commands](#commands).
- **Sync** — picks up timers started in the web or mobile app (default every minute).
- **Localized** — English, Russian, Ukrainian; follows the DMS locale.

## Requirements

- DMS 2.0 or newer.
- A Clockify account and an API key: Clockify → Profile settings → API → Generate.

The plugin talks to the API directly from the shell; no extra binaries are needed.

## Installation

### Home Manager (flake)

```nix
# flake.nix
inputs.dms-time-tracker.url = "github:DmitrySkibitsky/dms-time-tracker";

# home.nix
imports = [ inputs.dms-time-tracker.homeModules.default ];
programs.dms-time-tracker.enable = true;
```

### Manually

```bash
git clone https://github.com/DmitrySkibitsky/dms-time-tracker ~/.config/dms/plugins/timeTracker
```

The repository is the plugin: `lib/tracker.mjs` is the compiled TypeScript and is committed, so
no build step is needed.

### Enable

1. Settings → Plugins → scan, then enable **Time Tracker**.
2. Add the **Time Tracker** widget to a bar (Settings → Bar → widgets).
3. Open the plugin's settings, paste the API key. The status line shows *Connected as …*.
4. Optionally pick the workspace and a default project.

After updating the plugin run `dms restart` if new files were added (DMS caches each plugin's
file list until restart).

## Usage

| Action | How |
|---|---|
| Open the tracker | Left click the bar widget |
| Start / stop | Right click the widget, the Control Center tile, `Enter` in the description field or the Start/Stop button |
| Continue a past entry | Hover it → ▶ |
| Edit an entry | Click it (or hover → ✎) |
| Add time manually | `+` in the popout header |
| Change the running timer's start | Click "Started at …" under the clock |
| Discard the running timer | 🗑 next to Stop, click twice |

Times accept `9`, `930`, `09:30`, `9.30`, `9:30pm`; durations accept `1:30`, `1h30m`, `90m`,
`1.5h`, `45` (minutes). An end time earlier than the start means the next day.

### Commands

```bash
dms ipc call timetracker toggle
dms ipc call timetracker start "Write release notes"   # uses the default project
dms ipc call timetracker stop
dms ipc call timetracker continueLast                   # restart the most recent entry
dms ipc call timetracker accounts                       # list accounts, * marks the active one
dms ipc call timetracker account Work                   # switch account by name or id
dms ipc call timetracker refresh
dms ipc call timetracker status                         # JSON: running, description, elapsed, today, …
```

Example keybinding (niri):

```kdl
Mod+T { spawn "dms" "ipc" "call" "timetracker" "toggle"; }
```

## Privacy and security

- The API key is stored by DMS with the other plugin settings in
  `~/.config/dms/plugin_settings.json`, in plain text. Keep that file private and out of public
  dotfiles repositories.
- Requests go only to the configured API URL.

## Not implemented (yet)

Compared to the Clockify desktop app: idle detection, reminders, Pomodoro, and offline queuing of
changes. Ideas and PRs are welcome.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the toolchain, tests, linting and release process, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the plugin is put together.

## License

[MIT](LICENSE)
