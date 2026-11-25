pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io
import qs.Common
import qs.Services
import qs.Modules.Plugins
import "lib"
import "lib/tracker.mjs" as Tracker
import "ui"

// Background surface, instantiated once. Owns the single TrackerService (state, polling,
// network), publishes it to bar widgets and settings through the plugin global variable
// "service", exposes IPC commands and turns errors into toasts.
PluginComponent {
    id: root

    property var popoutService: null
    property string _lastToast: ""

    function saveData(key, value) {
        if (root.pluginService)
            root.pluginService.savePluginData(root.pluginId, key, value);
    }

    function publish() {
        if (root.pluginId)
            PluginService.setGlobalVar(root.pluginId, "service", service);
    }

    function notify(result, successMessage) {
        if (result.ok) {
            if (successMessage)
                ToastService.showInfo(successMessage);
        } else {
            ToastService.showError(I18n.trFor("timeTracker", "Time Tracker"), texts.error(result.code, result.error));
        }
    }

    Component.onCompleted: publish()
    onPluginIdChanged: publish()

    Component.onDestruction: {
        if (root.pluginId && PluginService.getGlobalVar(root.pluginId, "service", null) === service)
            PluginService.setGlobalVar(root.pluginId, "service", null);
    }

    Texts {
        id: texts
    }

    TrackerService {
        id: service

        pluginData: root.pluginData

        // Saved on the active account; the store picks the new value up through pluginData.
        onPreferenceChanged: (key, value) => {
            const patch = {};
            patch[key] = value;
            root.saveData("accounts", Tracker.updateActiveAccount(root.pluginData, patch));
        }

        onStatusChanged: {
            if (status === "ready")
                root._lastToast = "";
        }

        // Validation problems are shown inline by the forms. Repeated identical
        // failures (e.g. the retry loop while offline) are toasted once.
        onErrorOccurred: (message, code) => {
            if (texts.isValidation(code))
                return;
            const text = texts.error(code, message);
            if (text === root._lastToast)
                return;
            root._lastToast = text;
            ToastService.showError(I18n.trFor("timeTracker", "Time Tracker"), text);
        }
    }

    // dms ipc call timetracker <function> [args]
    IpcHandler {
        target: "timetracker"

        function toggle(): string {
            if (!service.ready)
                return "not ready: " + service.status;
            const wasRunning = service.running;
            service.toggle().then(r => root.notify(r, ""));
            return wasRunning ? "stopping" : "starting";
        }

        function start(description: string): string {
            if (!service.ready)
                return "not ready: " + service.status;
            const overrides = description ? {
                description: description
            } : {};
            service.start(overrides).then(r => root.notify(r, ""));
            return "starting";
        }

        function stop(): string {
            if (!service.running)
                return "not running";
            service.stop().then(r => root.notify(r, ""));
            return "stopping";
        }

        function continueLast(): string {
            const last = service.snapshot && service.snapshot.entries.length ? service.snapshot.entries[0] : null;
            if (!last)
                return "no recent entry";
            service.continueEntry(last.id).then(r => root.notify(r, ""));
            return "continuing: " + (last.description || last.projectName || last.id);
        }

        // Lists accounts as "id<TAB>name", the active one marked with "*".
        function accounts(): string {
            const active = Tracker.activeAccount(root.pluginData).id;
            return Tracker.accounts(root.pluginData).map(a => (a.id === active ? "* " : "  ") + a.id + "\t" + a.name).join("\n");
        }

        // Switches the active account by id or (case-insensitive) name.
        function account(idOrName: string): string {
            const wanted = idOrName.trim().toLowerCase();
            const match = Tracker.accounts(root.pluginData).find(a => a.id.toLowerCase() === wanted || a.name.toLowerCase() === wanted);
            if (!match)
                return "unknown account: " + idOrName;
            root.saveData("activeAccount", match.id);
            return "switched to " + match.name;
        }

        function refresh(): string {
            service.refresh();
            return "refreshing";
        }

        function status(): string {
            const s = service.snapshot;
            const running = s ? s.running : null;
            return JSON.stringify({
                status: service.status,
                account: Tracker.activeAccount(root.pluginData).name,
                provider: s ? s.providerId : "",
                workspace: s ? s.workspaceName : "",
                running: !!running,
                description: running ? running.description : "",
                project: running ? running.projectName : "",
                elapsed: service.elapsed,
                elapsedText: Tracker.formatDuration(service.elapsed),
                today: service.todayTotal,
                todayText: Tracker.formatDuration(service.todayTotal),
                week: service.weekTotal,
                error: s ? s.error : ""
            });
        }
    }
}
