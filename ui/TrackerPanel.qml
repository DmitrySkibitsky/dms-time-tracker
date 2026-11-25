pragma ComponentBehavior: Bound

import QtQuick
import qs.Common
import qs.DCommon.Widgets
import "../lib/tracker.mjs" as Tracker

// Popout body: connection states, the timer card and either the history list or the editor.
Item {
    id: panel

    required property var service
    required property var texts
    property var openSettings: null
    // Plugin settings (timer field visibility).
    property var pluginData: ({})

    // Header. Drawn here instead of PopoutComponent's header, which neither elides the title nor
    // reserves room for actions, so long workspace names ran under the account switcher.
    property string title: ""
    property string details: ""
    property var accounts: []
    property string activeAccountId: ""
    property var switchAccount: null

    readonly property var trackerState: service ? service.snapshot : null
    readonly property string status: service ? service.status : "missing"

    // null = history list; {entry: null} = new entry; {entry: <view>} = edit.
    property var editing: null

    function addEntry() {
        editing = {
            entry: null
        };
    }

    function editEntry(entry) {
        editing = {
            entry: entry
        };
    }

    function report(promise) {
        promise.then(result => {
            if (!result.ok)
                listMessage.text = panel.texts.error(result.code, result.error);
            else
                listMessage.text = "";
        });
    }

    Item {
        id: header

        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        // Title and actions share the first line; the totals line below gets the full width.
        height: titleLine.height + (detailsText.visible ? detailsText.implicitHeight + 2 : 0)

        Item {
            id: titleLine

            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: Math.max(titleText.implicitHeight, actions.implicitHeight)
        }

        StyledText {
            id: titleText

            anchors.left: parent.left
            anchors.right: actions.left
            anchors.rightMargin: Theme.spacingS
            anchors.verticalCenter: titleLine.verticalCenter
            text: panel.title
            font.pixelSize: Theme.fontSizeLarge + 4
            color: Theme.surfaceText
            elide: Text.ElideRight
            // StyledText word-wraps by default; a single line is what elide needs.
            wrapMode: Text.NoWrap
        }

        StyledText {
            id: detailsText

            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: titleLine.bottom
            anchors.topMargin: 2
            visible: text !== ""
            text: panel.details
            font.pixelSize: Theme.fontSizeMedium
            color: Theme.surfaceVariantText
            elide: Text.ElideRight
            // StyledText word-wraps by default; a single line is what elide needs.
            wrapMode: Text.NoWrap
        }

        Row {
            id: actions

            anchors.right: parent.right
            anchors.verticalCenter: titleLine.verticalCenter
            spacing: 0

            // Quick account switch (only with more than one account): an icon that opens the
            // account list, so the header keeps its room for the title and totals.
            DIconButton {
                id: accountButton

                readonly property var activeAccount: panel.accounts.find(a => a.id === panel.activeAccountId)

                anchors.verticalCenter: parent.verticalCenter
                visible: panel.accounts.length > 1
                iconName: "switch_account"
                tooltipText: I18n.trFor("timeTracker", "Account: %1").arg(activeAccount ? activeAccount.name : "")
                onClicked: accountMenu.openDropdownMenu()
            }

            // Menu only: no trigger of its own, anchored to the icon above.
            DDropdown {
                id: accountMenu

                showTrigger: false
                popupAnchorItem: accountButton
                alignPopupRight: true
                popupWidth: 220
                options: panel.accounts.map(a => a.name)
                optionValues: panel.accounts.map(a => a.id)
                Binding on currentValue {
                    value: panel.activeAccountId
                }
                onValueChanged: value => {
                    if (panel.switchAccount)
                        panel.switchAccount(value);
                }
            }

            DIconButton {
                anchors.verticalCenter: parent.verticalCenter
                visible: panel.status === "ready"
                iconName: "add"
                tooltipText: I18n.trFor("timeTracker", "Add time entry")
                onClicked: panel.addEntry()
            }

            DIconButton {
                anchors.verticalCenter: parent.verticalCenter
                visible: panel.status === "ready"
                iconName: "refresh"
                tooltipText: I18n.trFor("timeTracker", "Sync now")
                onClicked: panel.service.refresh()
            }

            DIconButton {
                anchors.verticalCenter: parent.verticalCenter
                visible: !!panel.openSettings
                iconName: "settings"
                tooltipText: I18n.trFor("timeTracker", "Settings")
                onClicked: panel.openSettings()
            }
        }
    }

    Item {
        id: body

        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: header.bottom
        anchors.topMargin: Theme.spacingM
        anchors.bottom: parent.bottom
    }

    // Shown when there is no working connection.
    Column {
        anchors.centerIn: body
        width: parent.width - Theme.spacingXL * 2
        spacing: Theme.spacingM
        visible: panel.status !== "ready"

        DLoadingIndicator {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: panel.status === "loading"
            size: 48
        }

        DIcon {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: panel.status !== "loading"
            name: panel.status === "error" ? "cloud_off" : "key"
            size: 48
            color: panel.status === "error" ? Theme.error : Theme.surfaceVariantText
        }

        StyledText {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            color: Theme.surfaceText
            font.pixelSize: Theme.fontSizeMedium
            text: {
                switch (panel.status) {
                case "missing":
                    return I18n.trFor("timeTracker", "The Time Tracker background service isn't running. Re-enable the plugin.");
                case "loading":
                    return I18n.trFor("timeTracker", "Connecting…");
                case "unconfigured":
                    return I18n.trFor("timeTracker", "Connect your time tracking account in the plugin settings.");
                default:
                    return panel.texts.error(panel.trackerState ? panel.trackerState.errorKind : "", panel.trackerState ? panel.trackerState.error : "");
                }
            }
        }

        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: Theme.spacingS
            visible: panel.status === "error" || panel.status === "unconfigured"

            DButton {
                visible: panel.status === "error"
                text: I18n.trFor("timeTracker", "Retry")
                iconName: "refresh"
                onClicked: panel.service.reload()
            }

            DButton {
                visible: !!panel.openSettings
                text: I18n.trFor("timeTracker", "Open settings")
                iconName: "settings"
                variant: panel.status === "error" ? "tonal" : "filled"
                onClicked: panel.openSettings()
            }
        }
    }

    Column {
        anchors.fill: body
        spacing: Theme.spacingM
        visible: panel.status === "ready"

        TimerCard {
            id: timerCard
            width: parent.width
            visible: panel.editing === null
            service: panel.service
            texts: panel.texts
            pluginData: panel.pluginData
        }

        Loader {
            width: parent.width
            height: parent.height - (timerCard.visible ? timerCard.height + parent.spacing : 0)
            active: panel.editing !== null
            visible: active

            sourceComponent: EntryEditor {
                service: panel.service
                texts: panel.texts
                entry: panel.editing ? panel.editing.entry : null
                onClosed: panel.editing = null
            }
        }

        Item {
            width: parent.width
            height: parent.height - timerCard.height - parent.spacing
            visible: panel.editing === null

            StyledText {
                id: listMessage
                width: parent.width
                visible: text !== ""
                color: Theme.error
                font.pixelSize: Theme.fontSizeSmall
                wrapMode: Text.WordWrap
            }

            StyledText {
                anchors.centerIn: parent
                visible: panel.trackerState && panel.trackerState.days.length === 0
                text: I18n.trFor("timeTracker", "No time entries yet")
                color: Theme.surfaceVariantText
                font.pixelSize: Theme.fontSizeMedium
            }

            // DListView: the shell's list with a scrollbar, edge fades and kinetic scrolling. It
            // also keeps the scroll position when a new snapshot replaces the model.
            DListView {
                id: history

                anchors.fill: parent
                anchors.topMargin: listMessage.visible ? listMessage.height + Theme.spacingS : 0
                clip: true
                spacing: Theme.spacingS
                model: panel.trackerState ? panel.trackerState.days : []

                delegate: Column {
                    id: day

                    required property var modelData

                    width: ListView.view.width
                    spacing: 2

                    // Day header: a tinted bar so days stand apart from the entries below.
                    Rectangle {
                        width: parent.width
                        height: Theme.listItemHeight * 0.8
                        radius: Theme.cornerRadiusS
                        color: Theme.cardSurface

                        Row {
                            anchors.left: parent.left
                            anchors.leftMargin: Theme.spacingS
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: Theme.spacingS

                            DIcon {
                                anchors.verticalCenter: parent.verticalCenter
                                name: day.modelData.daysAgo === 0 ? "today" : "calendar_today"
                                size: Theme.iconSizeSmall
                                color: Theme.primary
                            }

                            StyledText {
                                anchors.verticalCenter: parent.verticalCenter
                                text: panel.texts.dayLabel(day.modelData)
                                font.pixelSize: Theme.fontSizeMedium
                                font.weight: Font.Bold
                                color: Theme.surfaceText
                            }

                            // "Today"/"Yesterday" also get the calendar date.
                            StyledText {
                                anchors.verticalCenter: parent.verticalCenter
                                visible: day.modelData.daysAgo <= 1
                                text: panel.texts.dayDate(day.modelData)
                                font.pixelSize: Theme.fontSizeSmall
                                color: Theme.surfaceVariantText
                            }
                        }

                        StyledText {
                            anchors.right: parent.right
                            anchors.rightMargin: Theme.spacingS
                            anchors.verticalCenter: parent.verticalCenter
                            text: Tracker.formatDuration(day.modelData.total)
                            font.pixelSize: Theme.fontSizeMedium
                            font.weight: Font.Bold
                            color: Theme.primary
                        }
                    }

                    Repeater {
                        model: day.modelData.entries

                        delegate: EntryRow {
                            id: entryRow

                            required property var modelData

                            entry: entryRow.modelData
                            texts: panel.texts
                            onContinueRequested: panel.report(panel.service.continueEntry(entryRow.modelData.id))
                            onEditRequested: panel.editEntry(entryRow.modelData)
                            onDeleteRequested: panel.report(panel.service.deleteEntry(entryRow.modelData.id))
                        }
                    }
                }
            }
        }
    }
}
