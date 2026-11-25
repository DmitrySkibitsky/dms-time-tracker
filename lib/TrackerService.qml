pragma ComponentBehavior: Bound

import QtQuick
import "tracker.mjs" as Tracker

// Reactive QML wrapper around the TypeScript TrackerStore.
// Depends only on QtQuick so it can be tested with qmltestrunner; the daemon owns
// one instance and shares it with every widget through a plugin global variable.
Item {
    id: service

    // Plugin settings as saved by the settings screen (PluginComponent.pluginData).
    property var pluginData: ({})
    // Optional transport override (tests); null uses the QML XMLHttpRequest.
    property var transport: null
    // Optional clock override (tests); null uses Date.now().
    property var clock: null
    // Disables periodic sync (tests).
    property bool pollingEnabled: true

    readonly property int pollSeconds: Math.max(0, Number(pluginData && pluginData.pollInterval !== undefined ? pluginData.pollInterval : 60) || 0)

    // Latest StoreState; replaced on every change so bindings update.
    // (Not called "state": that would shadow Item.state.)
    property var snapshot: null
    // Wall clock in ms, ticking every second while a timer runs.
    property real now: _now()

    readonly property string status: snapshot ? snapshot.status : "unconfigured"
    readonly property bool ready: status === "ready"
    readonly property bool running: !!(snapshot && snapshot.running)
    readonly property var runningEntry: snapshot ? snapshot.running : null
    readonly property bool busy: !!(snapshot && snapshot.pending > 0)
    readonly property int elapsed: snapshot ? Tracker.elapsed(snapshot, now) : 0
    readonly property int todayTotal: snapshot ? Tracker.todayTotal(snapshot, now) : 0
    readonly property int weekTotal: snapshot ? Tracker.weekTotal(snapshot, now) : 0

    signal errorOccurred(string message, string code)
    // A UI choice worth keeping across timers (e.g. "defaultBillable"); the daemon persists it.
    signal preferenceChanged(string key, var value)

    property var _store: null

    function _now() {
        return clock ? clock() : Date.now();
    }

    function configure() {
        if (_store)
            return _store.configure(Tracker.configFromPluginData(pluginData));
        return Promise.resolve({
            ok: false,
            code: "not-ready",
            error: ""
        });
    }

    // Actions; each returns a Promise of {ok, code, error} and never rejects.
    function reload() {
        return _store.reload();
    }
    function refresh() {
        return _store.refresh();
    }
    function start(overrides) {
        return _store.start(overrides || {});
    }
    function stop() {
        return _store.stop();
    }
    function toggle() {
        return _store.toggle();
    }
    function updateRunning(patch) {
        return _store.updateRunning(patch);
    }
    function createEntry(draft) {
        return _store.createEntry(draft);
    }
    function updateEntry(id, draft) {
        return _store.updateEntry(id, draft);
    }
    function deleteEntry(id) {
        return _store.deleteEntry(id);
    }
    function continueEntry(id) {
        return _store.continueEntry(id);
    }
    function duplicateEntry(id) {
        return _store.duplicateEntry(id);
    }
    function loadTasks(projectId) {
        return _store.loadTasks(projectId);
    }
    function setDraft(patch) {
        _store.setDraft(patch);
    }
    function resetDraft() {
        _store.resetDraft();
    }
    // Preferences live on the active account (e.g. its "defaultBillable").
    function rememberPreference(key, value) {
        if (Tracker.activeAccount(pluginData)[key] === value)
            return;
        preferenceChanged(key, value);
    }

    Component.onCompleted: {
        const options = {
            onChange: s => {
                service.snapshot = s;
                service.now = service._now();
            },
            onError: (message, code) => service.errorOccurred(message, code || "")
        };
        if (transport)
            options.transport = transport;
        if (clock)
            options.now = clock;
        // Back-off for "429 Too Many Requests" (V4 has no setTimeout).
        options.delay = ms => service._delay(ms);
        _store = Tracker.createStore(options);
        snapshot = _store.state;
        configure();
    }

    // Settings are often saved several times in a row (account switch, typing); apply them once.
    onPluginDataChanged: configureDebounce.restart()

    Timer {
        id: configureDebounce
        interval: 300
        onTriggered: service.configure()
    }

    Component {
        id: delayTimer

        Timer {
            property var done: null
            repeat: false
            onTriggered: {
                done();
                destroy();
            }
        }
    }

    function _delay(ms) {
        return new Promise(resolve => {
            const timer = delayTimer.createObject(service, {
                interval: Math.max(1, ms),
                done: resolve
            });
            timer.start();
        });
    }

    Timer {
        interval: 1000
        repeat: true
        running: service.running
        onTriggered: service.now = service._now()
    }

    Timer {
        interval: Math.max(15, service.pollSeconds) * 1000
        repeat: true
        running: service.pollingEnabled && service.pollSeconds > 0 && service._store !== null
        onTriggered: service._store.refresh()
    }
}
