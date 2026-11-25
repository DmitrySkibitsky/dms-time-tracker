import QtQuick
import QtTest
import "../../lib"
import "../../lib/tracker.mjs" as Tracker
import "generated/fakes.mjs" as Fakes

// Runs the bundled lib/tracker.mjs inside a real QML engine through TrackerService,
// against the in-memory Clockify fake.
TestCase {
    id: tc
    name: "TrackerService"

    readonly property real noon: Date.UTC(2024, 4, 15, 12)
    property real fakeNow: noon
    property var fake: null
    property var errors: []

    Component {
        id: serviceComponent
        TrackerService {
            pollingEnabled: false
            clock: () => tc.fakeNow
            onErrorOccurred: (message, code) => tc.errors.push(code)
        }
    }

    function makeService(data) {
        const s = createTemporaryObject(serviceComponent, tc, {
            transport: fake.transport,
            pluginData: data
        });
        verify(s !== null);
        return s;
    }

    function init() {
        fakeNow = noon;
        errors = [];
        fake = Fakes.createClockifyFake();
    }

    function test_unconfigured_without_key() {
        const s = makeService({});
        tryCompare(s, "status", "unconfigured");
        compare(s.ready, false);
        compare(fake.state.requests.length, 0);
    }

    function test_loads_and_tracks() {
        fake.seed({
            description: "Morning",
            projectId: "p-web",
            start: noon - 3 * 3600000,
            end: noon - 2 * 3600000
        });
        const s = makeService({
            "clockify.apiKey": Fakes.FAKE_API_KEY
        });
        tryCompare(s, "status", "ready");
        compare(s.snapshot.workspaceName, "Main");
        compare(s.snapshot.entries.length, 1);
        compare(s.snapshot.entries[0].projectName, "Website");
        compare(s.running, false);
        compare(s.todayTotal, 3600);

        s.setDraft({
            description: "QML timer",
            projectId: "p-int"
        });
        compare(s.snapshot.draft.description, "QML timer");
        let result = null;
        s.start().then(r => result = r);
        tryVerify(() => result !== null);
        verify(result.ok);
        compare(s.running, true);
        compare(s.runningEntry.description, "QML timer");

        fakeNow = noon + 25 * 60000;
        s.now = fakeNow;
        compare(s.elapsed, 25 * 60);
        compare(s.todayTotal, 3600 + 25 * 60);

        result = null;
        s.stop().then(r => result = r);
        tryVerify(() => result !== null);
        verify(result.ok);
        compare(s.running, false);
        compare(s.snapshot.entries.length, 2);
        compare(s.snapshot.entries[0].duration, 25 * 60);
    }

    function test_settings_change_reconfigures() {
        const s = makeService({
            "clockify.apiKey": Fakes.FAKE_API_KEY
        });
        tryCompare(s, "status", "ready");
        s.pluginData = {
            "clockify.apiKey": Fakes.FAKE_API_KEY,
            workspaceId: "ws-2"
        };
        tryVerify(() => s.ready && s.snapshot.workspaceId === "ws-2");
        compare(s.snapshot.projects.length, 1);
    }

    function test_switching_accounts() {
        const accounts = [
            {
                id: "personal",
                name: "Personal",
                provider: "clockify",
                settings: {
                    apiKey: "wrong"
                }
            },
            {
                id: "work",
                name: "Work",
                provider: "clockify",
                settings: {
                    apiKey: Fakes.FAKE_API_KEY
                },
                workspaceId: "ws-2",
                defaultBillable: true
            }
        ];
        const s = makeService({
            accounts: accounts,
            activeAccount: "personal"
        });
        tryCompare(s, "status", "error");
        s.pluginData = {
            accounts: accounts,
            activeAccount: "work"
        };
        tryCompare(s, "status", "ready");
        compare(s.snapshot.workspaceId, "ws-2");
        compare(s.snapshot.draft.billable, true);
    }

    function test_rate_limit_is_retried() {
        const s = makeService({
            "clockify.apiKey": Fakes.FAKE_API_KEY
        });
        tryCompare(s, "status", "ready");
        fake.state.failNext = {
            status: 429,
            message: "Too many requests"
        };
        let result = null;
        s.start({
            description: "after back-off"
        }).then(r => result = r);
        tryVerify(() => result !== null, 5000);
        verify(result.ok, result.error);
        compare(s.runningEntry.description, "after back-off");
        compare(errors.length, 0);
    }

    function test_errors_are_signalled() {
        const s = makeService({
            "clockify.apiKey": "wrong"
        });
        tryCompare(s, "status", "error");
        compare(errors[errors.length - 1], "auth");
        verify(s.snapshot.error.length > 0);
    }

    function test_edit_and_delete_entry() {
        const seeded = fake.seed({
            description: "Typo",
            start: noon - 2 * 3600000,
            end: noon - 3600000
        });
        const s = makeService({
            "clockify.apiKey": Fakes.FAKE_API_KEY
        });
        tryCompare(s, "status", "ready");

        const range = Tracker.resolveRange(Tracker.dayKey(noon), "09:00", "10:15", false);
        compare(range.error, "");
        const draft = Tracker.draftFromEntry(s.snapshot.entries[0]);
        draft.description = "Fixed";
        draft.start = range.start;
        draft.end = range.end;
        let result = null;
        s.updateEntry(seeded.id, draft).then(r => result = r);
        tryVerify(() => result !== null);
        verify(result.ok, result.error);
        compare(s.snapshot.entries[0].description, "Fixed");
        compare(s.snapshot.entries[0].duration, 75 * 60);

        result = null;
        s.deleteEntry(seeded.id).then(r => result = r);
        tryVerify(() => result !== null);
        compare(s.snapshot.entries.length, 0);
    }
}
