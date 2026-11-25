pragma ComponentBehavior: Bound

import QtQuick
import qs.Common
import qs.Services
import qs.DCommon.Widgets
import qs.Modules.Plugins
import "lib/tracker.mjs" as Tracker
import "ui"

// Settings → Plugins → Time Tracker. Provider fields are rendered from the provider's
// descriptor, so a new provider needs no changes here.
PluginSettings {
    id: root

    pluginId: "timeTracker"

    // All saved values; refreshed whenever the plugin data changes.
    property var saved: ({})
    readonly property var accountList: Tracker.accounts(saved)
    // Everything in "Account" and "Tracking" edits the active account.
    readonly property var account: Tracker.activeAccount(saved)
    readonly property string providerId: account.provider
    readonly property var provider: Tracker.findProvider(providerId)
    readonly property var service: {
        const vars = PluginService.globalVars[root.pluginId];
        return vars && vars.service ? vars.service : null;
    }
    readonly property var trackerState: service ? service.snapshot : null
    readonly property bool ready: !!service && service.ready
    readonly property var defaultTasks: account.defaultProjectId && trackerState && trackerState.tasks[account.defaultProjectId] ? trackerState.tasks[account.defaultProjectId] : []
    property bool confirmDelete: false

    function refreshData() {
        root.saved = SettingsData.getPluginSettingsForPlugin(root.pluginId) || {};
    }

    function save(key, value) {
        root.saveValue(key, value);
        refreshData();
    }

    function patchAccount(patch) {
        save("accounts", Tracker.updateActiveAccount(root.saved, patch));
    }

    function addAccount() {
        const result = Tracker.addAccount(root.saved, root.providerId, Date.now());
        save("accounts", result.accounts);
        save("activeAccount", result.id);
    }

    function deleteActiveAccount() {
        const result = Tracker.deleteAccount(root.saved, root.account.id);
        save("accounts", result.accounts);
        save("activeAccount", result.activeId);
        confirmDelete = false;
    }

    Component.onCompleted: refreshData()

    Connections {
        target: root.pluginService
        function onPluginDataChanged(changedPluginId) {
            if (changedPluginId === root.pluginId)
                root.refreshData();
        }
    }

    // The default-task list needs the default project's tasks; the store caches them.
    function loadDefaultTasks() {
        if (ready && account.defaultProjectId)
            service.loadTasks(account.defaultProjectId);
    }

    onReadyChanged: loadDefaultTasks()
    onSavedChanged: loadDefaultTasks()

    Texts {
        id: strings
    }

    // ── Accounts ─────────────────────────────────────────────────────────────

    StyledText {
        width: parent.width
        text: I18n.trFor("timeTracker", "Accounts")
        font.pixelSize: Theme.fontSizeLarge
        font.weight: Font.Medium
        color: Theme.surfaceText
    }

    Item {
        width: parent.width
        height: Math.max(accountDropdown.implicitHeight, accountButtons.implicitHeight)

        DDropdown {
            id: accountDropdown

            anchors.left: parent.left
            anchors.right: accountButtons.left
            anchors.rightMargin: Theme.spacingS
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - accountButtons.width - Theme.spacingS
            text: I18n.trFor("timeTracker", "Active account")
            description: I18n.trFor("timeTracker", "Also switchable from the popout header")
            options: root.accountList.map(a => a.name)
            optionValues: root.accountList.map(a => a.id)
            Binding on currentValue {
                value: root.account.id
            }
            onValueChanged: value => {
                if (value && value !== root.account.id) {
                    root.confirmDelete = false;
                    root.save("activeAccount", value);
                }
            }
        }

        Row {
            id: accountButtons

            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0

            DIconButton {
                iconName: "person_add"
                tooltipText: I18n.trFor("timeTracker", "Add account")
                onClicked: root.addAccount()
            }

            DIconButton {
                visible: root.accountList.length > 1
                iconName: root.confirmDelete ? "delete_forever" : "delete"
                iconColor: root.confirmDelete ? Theme.error : Theme.surfaceVariantText
                tooltipText: root.confirmDelete ? I18n.trFor("timeTracker", "Click again to delete this account") : I18n.trFor("timeTracker", "Delete account")
                onClicked: {
                    if (root.confirmDelete)
                        root.deleteActiveAccount();
                    else
                        root.confirmDelete = true;
                }
            }
        }
    }

    Column {
        width: parent.width
        spacing: Theme.spacingXS

        StyledText {
            text: I18n.trFor("timeTracker", "Account name")
            font.pixelSize: Theme.fontSizeMedium
            font.weight: Theme.fontWeightMedium
            color: Theme.surfaceText
        }

        DTextField {
            id: nameField

            function commit() {
                const name = text.trim();
                if (name && name !== root.account.name)
                    root.patchAccount({
                        name: name
                    });
            }

            width: parent.width
            placeholderText: I18n.trFor("timeTracker", "e.g. Work")
            // Follows the active account, but not while being typed into.
            Binding on text {
                value: root.account.name
                when: !nameField.inputFocused
            }
            onEditingFinished: commit()
            onFocusStateChanged: hasFocus => {
                if (!hasFocus)
                    commit();
            }
        }
    }

    DDropdown {
        width: parent.width
        text: I18n.trFor("timeTracker", "Service")
        description: I18n.trFor("timeTracker", "Time tracking service to connect to")
        options: Tracker.providers.map(p => p.name)
        optionValues: Tracker.providers.map(p => p.id)
        Binding on currentValue {
            value: root.providerId
        }
        onValueChanged: value => {
            if (value && value !== root.providerId)
                root.patchAccount({
                    provider: value
                });
        }
    }

    Column {
        width: parent.width
        spacing: Theme.spacingM

        Repeater {
            model: root.provider ? root.provider.settings : []

            delegate: Column {
                id: fieldColumn

                required property var modelData
                readonly property string storedValue: root.account.settings[fieldColumn.modelData.key] || ""

                function commit() {
                    const value = input.text.trim();
                    if (value === storedValue)
                        return;
                    const settings = {};
                    settings[fieldColumn.modelData.key] = value;
                    root.patchAccount({
                        settings: settings
                    });
                }

                width: parent.width
                spacing: Theme.spacingXS

                StyledText {
                    // Field labels come from the provider descriptor and are looked up in the
                    // plugin catalog (see translations/).
                    text: I18n.trFor("timeTracker", fieldColumn.modelData.label) + (fieldColumn.modelData.required ? " *" : "")
                    font.pixelSize: Theme.fontSizeMedium
                    font.weight: Theme.fontWeightMedium
                    color: Theme.surfaceText
                }

                StyledText {
                    width: parent.width
                    visible: fieldColumn.modelData.description !== ""
                    text: I18n.trFor("timeTracker", fieldColumn.modelData.description)
                    font.pixelSize: Theme.fontSizeSmall
                    color: Theme.surfaceVariantText
                    wrapMode: Text.WordWrap
                }

                DTextField {
                    id: input

                    width: parent.width
                    placeholderText: fieldColumn.modelData.placeholder
                    echoMode: fieldColumn.modelData.kind === "secret" ? TextInput.Password : TextInput.Normal
                    showPasswordToggle: fieldColumn.modelData.kind === "secret"
                    Binding on text {
                        value: fieldColumn.storedValue
                        when: !input.inputFocused
                    }
                    onEditingFinished: fieldColumn.commit()
                    onFocusStateChanged: hasFocus => {
                        if (!hasFocus)
                            fieldColumn.commit();
                    }
                }
            }
        }
    }

    Rectangle {
        width: parent.width
        height: statusRow.implicitHeight + Theme.spacingM * 2
        radius: Theme.cornerRadius
        color: Theme.chipSurface

        Row {
            id: statusRow

            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.margins: Theme.spacingM
            spacing: Theme.spacingS

            DIcon {
                anchors.verticalCenter: parent.verticalCenter
                name: !root.service ? "power_off" : root.ready ? "check_circle" : root.service.status === "error" ? "error" : root.service.status === "loading" ? "sync" : "key"
                size: Theme.iconSize
                color: root.ready ? Theme.primary : root.service && root.service.status === "error" ? Theme.error : Theme.surfaceVariantText
            }

            StyledText {
                width: parent.width - Theme.iconSize - reconnect.width - Theme.spacingS * 2
                anchors.verticalCenter: parent.verticalCenter
                wrapMode: Text.WordWrap
                color: Theme.surfaceText
                font.pixelSize: Theme.fontSizeSmall
                text: {
                    if (!root.service)
                        return I18n.trFor("timeTracker", "Enable the plugin to connect.");
                    // The snapshot can lag the status for a moment (e.g. while the plugin reloads).
                    const snapshot = root.trackerState;
                    const user = snapshot ? snapshot.user : null;
                    switch (root.service.status) {
                    case "ready":
                        return user ? I18n.trFor("timeTracker", "Connected as %1").arg(user.name + (user.email ? " <" + user.email + ">" : "")) : I18n.trFor("timeTracker", "Connecting…");
                    case "loading":
                        return I18n.trFor("timeTracker", "Connecting…");
                    case "error":
                        return strings.error(snapshot ? snapshot.errorKind : "", snapshot ? snapshot.error : "");
                    default:
                        return I18n.trFor("timeTracker", "Fill in the required fields to connect.");
                    }
                }
            }

            DButton {
                id: reconnect
                anchors.verticalCenter: parent.verticalCenter
                visible: !!root.service && root.service.status !== "unconfigured"
                text: I18n.trFor("timeTracker", "Reconnect")
                variant: "tonal"
                onClicked: root.service.reload()
            }
        }
    }

    // ── Tracking defaults ────────────────────────────────────────────────────

    StyledText {
        width: parent.width
        topPadding: Theme.spacingM
        text: I18n.trFor("timeTracker", "Tracking")
        font.pixelSize: Theme.fontSizeLarge
        font.weight: Font.Medium
        color: Theme.surfaceText
    }

    StyledText {
        width: parent.width
        visible: !root.ready
        text: I18n.trFor("timeTracker", "Connect first to choose a workspace and a default project.")
        font.pixelSize: Theme.fontSizeSmall
        color: Theme.surfaceVariantText
        wrapMode: Text.WordWrap
    }

    DDropdown {
        width: parent.width
        visible: root.ready && root.trackerState.capabilities.workspaces
        text: I18n.trFor("timeTracker", "Workspace")
        description: I18n.trFor("timeTracker", "Where entries are tracked")
        options: root.trackerState ? root.trackerState.workspaces.map(w => w.name) : []
        optionValues: root.trackerState ? root.trackerState.workspaces.map(w => w.id) : []
        Binding on currentValue {
            value: root.trackerState ? root.trackerState.workspaceId : ""
        }
        onValueChanged: value => {
            if (value && value !== root.trackerState.workspaceId)
                // Projects belong to a workspace; drop defaults from the old one.
                root.patchAccount({
                    workspaceId: value,
                    defaultProjectId: "",
                    defaultTaskId: ""
                });
        }
    }

    DDropdown {
        width: parent.width
        visible: root.ready && root.trackerState.capabilities.projects
        text: I18n.trFor("timeTracker", "Default project")
        description: I18n.trFor("timeTracker", "Preselected for new timers and quick starts (right click on the bar, IPC)")
        enableFuzzySearch: true
        readonly property var opts: Tracker.projectOptions(root.trackerState ? root.trackerState.projects : [], strings.noProject())
        options: opts.labels
        optionValues: opts.values
        emptyText: strings.noProject()
        Binding on currentValue {
            value: root.account.defaultProjectId
        }
        onValueChanged: value => {
            if (value === root.account.defaultProjectId)
                return;
            root.patchAccount({
                defaultProjectId: value,
                defaultTaskId: ""
            });
            if (value && root.service)
                root.service.loadTasks(value);
        }
    }

    DDropdown {
        width: parent.width
        visible: root.ready && root.trackerState.capabilities.tasks && root.defaultTasks.length > 0
        text: I18n.trFor("timeTracker", "Default task")
        enableFuzzySearch: true
        readonly property var opts: Tracker.taskOptions(root.defaultTasks, strings.noTask())
        options: opts.labels
        optionValues: opts.values
        Binding on currentValue {
            value: root.account.defaultTaskId
        }
        onValueChanged: value => {
            if (value !== root.account.defaultTaskId)
                root.patchAccount({
                    defaultTaskId: value
                });
        }
    }

    DToggle {
        width: parent.width
        text: I18n.trFor("timeTracker", "Billable by default")
        description: I18n.trFor("timeTracker", "New timers and entries start as billable. Also remembered when you switch it on the timer.")
        Binding on checked {
            value: root.account.defaultBillable
        }
        onToggled: checked => root.patchAccount({
                defaultBillable: checked
            })
    }

    SelectionSetting {
        settingKey: "pollInterval"
        label: I18n.trFor("timeTracker", "Sync interval")
        description: I18n.trFor("timeTracker", "How often to pick up changes made in other apps")
        options: [
            {
                label: I18n.trFor("timeTracker", "30 seconds"),
                value: "30"
            },
            {
                label: I18n.trFor("timeTracker", "1 minute"),
                value: "60"
            },
            {
                label: I18n.trFor("timeTracker", "2 minutes"),
                value: "120"
            },
            {
                label: I18n.trFor("timeTracker", "5 minutes"),
                value: "300"
            },
            {
                label: I18n.trFor("timeTracker", "Off"),
                value: "0"
            }
        ]
        defaultValue: "60"
    }

    SelectionSetting {
        settingKey: "historyDays"
        label: I18n.trFor("timeTracker", "History")
        description: I18n.trFor("timeTracker", "Days of entries shown in the popout")
        options: [
            {
                label: I18n.trFor("timeTracker", "7 days"),
                value: "7"
            },
            {
                label: I18n.trFor("timeTracker", "14 days"),
                value: "14"
            },
            {
                label: I18n.trFor("timeTracker", "30 days"),
                value: "30"
            }
        ]
        defaultValue: "14"
    }

    SelectionSetting {
        settingKey: "weekStart"
        label: I18n.trFor("timeTracker", "Week starts on")
        options: [
            {
                label: I18n.trFor("timeTracker", "Monday"),
                value: "1"
            },
            {
                label: I18n.trFor("timeTracker", "Sunday"),
                value: "0"
            }
        ]
        defaultValue: "1"
    }

    // ── Bar ──────────────────────────────────────────────────────────────────

    StyledText {
        width: parent.width
        topPadding: Theme.spacingM
        text: I18n.trFor("timeTracker", "Bar")
        font.pixelSize: Theme.fontSizeLarge
        font.weight: Font.Medium
        color: Theme.surfaceText
    }

    ToggleSetting {
        settingKey: "showDescription"
        label: I18n.trFor("timeTracker", "Show description")
        description: I18n.trFor("timeTracker", "Show what you're working on next to the running time")
        defaultValue: true
    }

    ToggleSetting {
        settingKey: "showProject"
        label: I18n.trFor("timeTracker", "Show project")
        defaultValue: false
    }

    ToggleSetting {
        settingKey: "showTodayWhenIdle"
        label: I18n.trFor("timeTracker", "Show today's total")
        description: I18n.trFor("timeTracker", "In the bar while no timer runs and on the Control Center tile. Turn off to keep it out of screenshots and recordings.")
        defaultValue: true
    }

    SelectionSetting {
        settingKey: "barLabelWidth"
        label: I18n.trFor("timeTracker", "Label width")
        description: I18n.trFor("timeTracker", "Longer descriptions and project names are cut off with an ellipsis")
        options: [
            {
                label: I18n.trFor("timeTracker", "Very narrow"),
                value: "60"
            },
            {
                label: I18n.trFor("timeTracker", "Narrow"),
                value: "100"
            },
            {
                label: I18n.trFor("timeTracker", "Medium"),
                value: "160"
            },
            {
                label: I18n.trFor("timeTracker", "Wide"),
                value: "240"
            }
        ]
        defaultValue: "100"
    }

    // ── Popout ───────────────────────────────────────────────────────────────

    StyledText {
        width: parent.width
        topPadding: Theme.spacingM
        text: I18n.trFor("timeTracker", "Popout")
        font.pixelSize: Theme.fontSizeLarge
        font.weight: Font.Medium
        color: Theme.surfaceText
    }

    ToggleSetting {
        settingKey: "showTotalsInPopout"
        label: I18n.trFor("timeTracker", "Show today's and this week's totals")
        description: I18n.trFor("timeTracker", "In the popout header")
        defaultValue: true
    }

    ToggleSetting {
        settingKey: "timerShowProject"
        label: I18n.trFor("timeTracker", "Project field")
        description: I18n.trFor("timeTracker", "Hidden fields still use their defaults: the default project and the billable setting above.")
        defaultValue: true
    }

    ToggleSetting {
        settingKey: "timerShowTags"
        label: I18n.trFor("timeTracker", "Tags field")
        defaultValue: true
    }

    ToggleSetting {
        settingKey: "timerShowBillable"
        label: I18n.trFor("timeTracker", "Billable button")
        defaultValue: true
    }

    StyledText {
        width: parent.width
        topPadding: Theme.spacingM
        text: I18n.trFor("timeTracker", "Right click the bar widget to start or stop the timer. Commands: dms ipc call timetracker toggle | start <description> | stop | continueLast | status")
        font.pixelSize: Theme.fontSizeSmall
        color: Theme.surfaceVariantText
        wrapMode: Text.WordWrap
    }
}
