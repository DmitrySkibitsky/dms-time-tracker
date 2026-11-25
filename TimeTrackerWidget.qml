pragma ComponentBehavior: Bound

import QtQuick
import qs.Common
import qs.Services
import qs.DCommon.Widgets
import qs.Modules.Plugins
import "lib/tracker.mjs" as Tracker
import "ui"

// Bar/dock pill, popout and Control Center tile. Instantiated per bar and screen; all of
// them share the daemon's TrackerService through the "service" plugin global variable.
PluginComponent {
    id: root

    property var popoutService: null

    readonly property var service: {
        const vars = PluginService.globalVars[root.pluginId];
        return vars && vars.service ? vars.service : null;
    }
    readonly property string status: service ? service.status : "missing"
    readonly property bool running: service ? service.running : false
    readonly property var entry: running ? service.runningEntry : null

    // Bar options (Settings → Bar).
    readonly property bool showDescription: pluginData.showDescription !== undefined ? !!pluginData.showDescription : true
    readonly property bool showProject: !!pluginData.showProject
    // Daily total in the bar pill and the Control Center tile (can be hidden, e.g. for screen recordings).
    readonly property bool showTodayWhenIdle: pluginData.showTodayWhenIdle !== undefined ? !!pluginData.showTodayWhenIdle : true
    // "Today … · This week …" in the popout header.
    readonly property bool showTotalsInPopout: pluginData.showTotalsInPopout !== undefined ? !!pluginData.showTotalsInPopout : true
    readonly property real labelWidth: Number(pluginData.barLabelWidth || 100)

    readonly property var accountList: Tracker.accounts(pluginData)
    readonly property string activeAccountId: Tracker.activeAccount(pluginData).id

    function switchAccount(id) {
        if (id && id !== activeAccountId && root.pluginService)
            root.pluginService.savePluginData(root.pluginId, "activeAccount", id);
    }

    readonly property string elapsedText: Tracker.formatDuration(service ? service.elapsed : 0)
    readonly property string todayText: Tracker.formatDuration(service ? service.todayTotal : 0, false)
    readonly property string runningLabel: {
        if (!entry)
            return "";
        const parts = [];
        if (showDescription && entry.description)
            parts.push(entry.description);
        if (showProject && entry.projectName)
            parts.push(entry.projectName);
        if (parts.length === 0 && showDescription && entry.projectName)
            parts.push(entry.projectName);
        return parts.join(" · ");
    }
    readonly property color accent: status === "error" ? Theme.error : running ? Theme.primary : Theme.widgetIconColor

    function toggleTimer() {
        if (!service || !service.ready)
            return;
        service.toggle().then(result => {
            if (!result.ok)
                ToastService.showError(I18n.trFor("timeTracker", "Time Tracker"), strings.error(result.code, result.error));
        });
    }

    function openSettings() {
        root.closePopout();
        if (root.popoutService && root.popoutService.openSettingsWithTab)
            root.popoutService.openSettingsWithTab("plugin:" + root.pluginId);
        else if (root.popoutService)
            root.popoutService.openSettings();
    }

    Texts {
        id: strings
    }

    popoutWidth: 460
    popoutHeight: 660
    pillRightClickAction: () => root.toggleTimer()

    ccWidgetIcon: running ? "timer" : "timer_off"
    // `entry` can be null for a moment while `running` is still true (snapshot in flight).
    ccWidgetPrimaryText: entry && entry.description ? entry.description : I18n.trFor("timeTracker", "Time Tracker")
    ccWidgetSecondaryText: {
        if (entry)
            return elapsedText + (entry.projectName ? " · " + entry.projectName : "");
        return showTodayWhenIdle ? I18n.trFor("timeTracker", "Not tracking · today %1").arg(todayText) : I18n.trFor("timeTracker", "Not tracking");
    }
    ccWidgetIsActive: running
    onCcWidgetToggled: toggleTimer()

    horizontalBarPill: Component {
        Row {
            spacing: Theme.spacingXS

            DIcon {
                anchors.verticalCenter: parent.verticalCenter
                name: root.status === "error" ? "timer_off" : "timer"
                size: root.iconSize
                color: root.accent
            }

            StyledText {
                anchors.verticalCenter: parent.verticalCenter
                visible: root.running || (root.showTodayWhenIdle && root.status === "ready")
                text: root.running ? root.elapsedText : root.todayText
                font.pixelSize: root.textSize
                color: root.running ? Theme.primary : Theme.widgetTextColor
            }

            StyledText {
                anchors.verticalCenter: parent.verticalCenter
                visible: text !== ""
                width: Math.min(implicitWidth, root.labelWidth)
                text: root.runningLabel
                elide: Text.ElideRight
                // StyledText word-wraps by default; a single line is what elide needs.
                wrapMode: Text.NoWrap
                font.pixelSize: root.textSize
                color: Theme.widgetTextColor
            }
        }
    }

    verticalBarPill: Component {
        Column {
            spacing: Theme.spacingXXS

            DIcon {
                anchors.horizontalCenter: parent.horizontalCenter
                name: root.status === "error" ? "timer_off" : "timer"
                size: root.iconSize
                color: root.accent
            }

            StyledText {
                anchors.horizontalCenter: parent.horizontalCenter
                visible: root.running
                text: Tracker.formatDuration(root.service ? root.service.elapsed : 0, false)
                font.pixelSize: root.textSize - 2
                color: Theme.primary
            }
        }
    }

    popoutContent: Component {
        PopoutComponent {
            TrackerPanel {
                width: parent.width
                height: root.popoutHeight - Theme.spacingL
                service: root.service
                texts: strings
                pluginData: root.pluginData
                openSettings: () => root.openSettings()
                title: root.service && root.service.snapshot && root.service.snapshot.workspaceName ? root.service.snapshot.workspaceName : I18n.trFor("timeTracker", "Time Tracker")
                details: root.status === "ready" && root.showTotalsInPopout ? I18n.trFor("timeTracker", "Today %1 · This week %2").arg(root.todayText).arg(Tracker.formatDuration(root.service.weekTotal, false)) : ""
                accounts: root.accountList
                activeAccountId: root.activeAccountId
                switchAccount: id => root.switchAccount(id)
            }
        }
    }
}
