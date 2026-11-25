import QtQuick
import QtTest
import "../../lib"
import "generated/fakes.mjs" as Fakes
import "generated/server.mjs" as Server

// End-to-end: TrackerService -> bundled store -> QML XMLHttpRequest -> HTTP mock server.
// Covers every HTTP verb the Clockify adapter uses (GET, POST, PUT, PATCH, DELETE).
TestCase {
    id: tc
    name: "HttpIntegration"

    Component {
        id: serviceComponent
        TrackerService {
            pollingEnabled: false
        }
    }

    function await_(promise) {
        let result = null;
        promise.then(r => result = r);
        tryVerify(() => result !== null, 10000);
        return result;
    }

    function test_full_cycle_over_http() {
        const s = createTemporaryObject(serviceComponent, tc, {
            pluginData: {
                "clockify.apiKey": Fakes.FAKE_API_KEY,
                "clockify.baseUrl": Server.BASE_URL
            }
        });
        tryCompare(s, "status", "ready", 10000);
        compare(s.snapshot.user.name, "Test User");
        verify(s.snapshot.entries.length >= 1);

        let r = await_(s.start({
            description: "Over HTTP",
            projectId: "p-web",
            tagIds: ["tag-rev"]
        }));
        verify(r.ok, r.error);
        compare(s.runningEntry.description, "Over HTTP");

        r = await_(s.updateRunning({
            description: "Over HTTP (edited)"
        }));
        verify(r.ok, r.error);
        compare(s.runningEntry.description, "Over HTTP (edited)");

        r = await_(s.stop());
        verify(r.ok, r.error);
        compare(s.running, false);
        const stopped = s.snapshot.entries[0];
        compare(stopped.description, "Over HTTP (edited)");
        compare(stopped.tagNames[0], "review");

        r = await_(s.deleteEntry(stopped.id));
        verify(r.ok, r.error);
        verify(!s.snapshot.entries.some(e => e.id === stopped.id));

        r = await_(s.refresh());
        verify(r.ok, r.error);
    }

    function test_bad_key_reports_auth_error() {
        const s = createTemporaryObject(serviceComponent, tc, {
            pluginData: {
                "clockify.apiKey": "wrong",
                "clockify.baseUrl": Server.BASE_URL
            }
        });
        tryCompare(s, "status", "error", 10000);
        compare(s.snapshot.errorKind, "auth");
    }

    function test_unreachable_server_reports_network_error() {
        const s = createTemporaryObject(serviceComponent, tc, {
            pluginData: {
                "clockify.apiKey": Fakes.FAKE_API_KEY,
                "clockify.baseUrl": "http://127.0.0.1:9/api/v1"
            }
        });
        tryCompare(s, "status", "error", 10000);
        compare(s.snapshot.errorKind, "network");
    }
}
