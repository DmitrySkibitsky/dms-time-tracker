pragma ComponentBehavior: Bound

import QtQuick
import qs.Common
import qs.DCommon.Widgets
import "../lib/tracker.mjs" as Tracker

// The timer: description, project/task/tags/billable and start/stop. While a timer runs,
// edits go straight to the running entry; otherwise they shape the next timer (the draft).
Rectangle {
    id: card

    required property var service
    required property var texts
    property var pluginData: ({})

    // Optional fields, each can be hidden in the settings. Hidden fields still get their
    // defaults (default project, remembered billable flag).
    readonly property bool projectVisible: caps.projects === true && pluginData.timerShowProject !== false
    readonly property bool tagsVisible: caps.tags === true && !!trackerState && trackerState.tags.length > 0 && pluginData.timerShowTags !== false
    readonly property bool billableVisible: caps.billable === true && pluginData.timerShowBillable !== false

    readonly property var trackerState: service ? service.snapshot : null
    readonly property var caps: trackerState ? trackerState.capabilities : ({})
    readonly property var requirements: trackerState ? trackerState.requirements : ({})
    readonly property bool running: service ? service.running : false
    readonly property var entry: running ? trackerState.running : null
    // The fields shown: the running entry or the next-timer draft.
    readonly property var form: running ? entry : (trackerState ? trackerState.draft : null)
    readonly property var tasks: form && form.projectId && trackerState.tasks[form.projectId] ? trackerState.tasks[form.projectId] : []
    readonly property var suggestions: !running && descField.inputFocused && trackerState ? Tracker.recentSuggestions(trackerState.entries, descField.text, 5) : []

    property string message: ""
    property bool tagsOpen: false
    property bool editingStart: false
    property bool confirmDiscard: false

    function report(promise) {
        promise.then(result => card.message = result.ok ? "" : card.texts.error(result.code, result.error));
    }

    // Applies a field change to the running entry or to the draft.
    function apply(patch) {
        message = "";
        if (running)
            report(service.updateRunning(patch));
        else
            service.setDraft(patch);
    }

    function startStop() {
        message = "";
        if (running) {
            report(service.stop());
        } else {
            report(service.start({
                description: descField.text
            }));
            descField.text = "";
        }
    }

    function commitDescription() {
        if (!form || descField.text === form.description)
            return;
        apply({
            description: descField.text
        });
    }

    function syncDescription() {
        if (!descField.inputFocused)
            descField.text = form ? form.description : "";
    }

    function setBillable(billable) {
        apply({
            billable: billable
        });
        service.rememberPreference("defaultBillable", billable);
    }

    function commitStart(text) {
        editingStart = false;
        const range = Tracker.resolveRange(Tracker.dayKey(entry.start), text, "", true);
        if (range.error) {
            message = texts.error(range.error, "");
            return;
        }
        if (range.start !== entry.start)
            apply({
                start: range.start
            });
    }

    onFormChanged: syncDescription()

    color: Theme.cardSurface
    radius: Theme.cornerRadius
    implicitHeight: content.implicitHeight + Theme.spacingM * 2

    Timer {
        id: discardReset
        interval: 3000
        onTriggered: card.confirmDiscard = false
    }

    Column {
        id: content

        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: Theme.spacingM
        spacing: Theme.spacingS

        DTextField {
            id: descField

            width: parent.width
            placeholderText: card.requirements.description ? I18n.trFor("timeTracker", "What are you working on? (required)") : I18n.trFor("timeTracker", "What are you working on?")
            showClearButton: true
            onAccepted: {
                if (card.running)
                    card.commitDescription();
                else
                    card.startStop();
            }
            onEditingFinished: card.commitDescription()
            onFocusStateChanged: hasFocus => {
                if (!hasFocus)
                    card.syncDescription();
            }
            Component.onCompleted: card.syncDescription()
        }

        // Recent entries matching the typed text; picking one fills every field.
        Column {
            width: parent.width
            visible: card.suggestions.length > 0
            spacing: 0

            Repeater {
                model: card.suggestions

                delegate: Rectangle {
                    id: suggestion

                    required property var modelData

                    width: parent.width
                    height: Theme.listItemHeight
                    radius: Theme.cornerRadiusS
                    color: suggestionHover.hovered ? Theme.chipSurface : "transparent"

                    HoverHandler {
                        id: suggestionHover
                    }

                    Row {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spacingS
                        anchors.rightMargin: Theme.spacingS
                        spacing: Theme.spacingS

                        Rectangle {
                            width: 8
                            height: 8
                            radius: 4
                            anchors.verticalCenter: parent.verticalCenter
                            color: suggestion.modelData.projectColor || Theme.outline
                        }

                        StyledText {
                            width: parent.width - 16 - Theme.spacingS * 2
                            anchors.verticalCenter: parent.verticalCenter
                            text: suggestion.modelData.description + (suggestion.modelData.projectName ? "  ·  " + suggestion.modelData.projectName : "")
                            elide: Text.ElideRight
                            // StyledText word-wraps by default; a single line is what elide needs.
                            wrapMode: Text.NoWrap
                            color: Theme.surfaceText
                            font.pixelSize: Theme.fontSizeSmall
                        }
                    }

                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            card.service.setDraft({
                                description: suggestion.modelData.description,
                                projectId: suggestion.modelData.projectId,
                                taskId: suggestion.modelData.taskId,
                                tagIds: suggestion.modelData.tagIds,
                                billable: suggestion.modelData.billable
                            });
                            descField.text = suggestion.modelData.description;
                            descField.setFocus(false);
                        }
                    }
                }
            }
        }

        Flow {
            width: parent.width
            visible: card.projectVisible || card.tagsVisible || card.billableVisible
            spacing: Theme.spacingS

            DDropdown {
                id: projectDropdown

                // Room left by the visible icon buttons, split with the task field if shown.
                readonly property real freeWidth: parent.width - (tagButton.visible ? tagButton.width + parent.spacing : 0) - (billableButton.visible ? billableButton.width + parent.spacing : 0)

                visible: card.projectVisible
                dropdownWidth: taskDropdown.visible ? (freeWidth - parent.spacing) / 2 : freeWidth
                enableFuzzySearch: true
                readonly property var opts: Tracker.projectOptions(card.trackerState ? card.trackerState.projects : [], card.requirements.project ? I18n.trFor("timeTracker", "Select a project") : card.texts.noProject())
                options: opts.labels
                optionValues: opts.values
                emptyText: card.requirements.project ? I18n.trFor("timeTracker", "Select a project") : I18n.trFor("timeTracker", "Project")
                // DDropdown assigns currentValue itself on selection, which would break a plain
                // binding; Binding keeps it following the draft/running entry.
                Binding on currentValue {
                    value: card.form && card.form.projectId ? card.form.projectId : ""
                }
                onValueChanged: value => {
                    if ((value || null) !== (card.form ? card.form.projectId : null))
                        card.apply({
                            projectId: value || null
                        });
                }
            }

            DDropdown {
                id: taskDropdown

                visible: card.projectVisible && card.caps.tasks === true && card.tasks.length > 0
                dropdownWidth: projectDropdown.dropdownWidth
                enableFuzzySearch: true
                readonly property var opts: Tracker.taskOptions(card.tasks, card.texts.noTask())
                options: opts.labels
                optionValues: opts.values
                emptyText: I18n.trFor("timeTracker", "Task")
                Binding on currentValue {
                    value: card.form && card.form.taskId ? card.form.taskId : ""
                }
                onValueChanged: value => {
                    if ((value || null) !== (card.form ? card.form.taskId : null))
                        card.apply({
                            taskId: value || null
                        });
                }
            }

            DIconButton {
                id: tagButton

                visible: card.tagsVisible
                iconName: "sell"
                iconColor: card.form && card.form.tagIds.length > 0 ? Theme.primary : Theme.surfaceVariantText
                tooltipText: I18n.trFor("timeTracker", "Tags")
                onClicked: {
                    card.tagsOpen = !card.tagsOpen;
                    if (card.tagsOpen)
                        tagPicker.open();
                    else
                        tagPicker.close();
                }
            }

            DIconButton {
                id: billableButton

                visible: card.billableVisible
                iconName: "attach_money"
                checkable: true
                // A click toggles `checked` internally; Binding re-syncs it with the entry.
                Binding on checked {
                    value: !!(card.form && card.form.billable)
                }
                tooltipText: checked ? I18n.trFor("timeTracker", "Billable") : I18n.trFor("timeTracker", "Non-billable")
                // The choice is remembered for the next timers.
                onClicked: card.setBillable(!(card.form && card.form.billable))
            }
        }

        TagPicker {
            id: tagPicker

            width: parent.width
            // Shown while picking, and whenever the entry has tags so they stay visible.
            visible: card.tagsVisible && (card.tagsOpen || (!!card.form && card.form.tagIds.length > 0))
            tags: card.trackerState ? card.trackerState.tags : []
            selectedIds: card.form ? card.form.tagIds : []
            onEdited: ids => card.apply({
                    tagIds: ids
                })
            onExpandedChanged: card.tagsOpen = expanded
        }

        Item {
            width: parent.width
            height: Math.max(timeColumn.implicitHeight, startStop.implicitHeight)

            Column {
                id: timeColumn

                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                spacing: 2

                StyledText {
                    text: Tracker.formatDuration(card.service ? card.service.elapsed : 0)
                    font.pixelSize: Theme.fontSizeXLarge + 6
                    font.weight: Font.Medium
                    color: card.running ? Theme.primary : Theme.surfaceVariantText
                }

                Row {
                    visible: card.running && !card.editingStart
                    spacing: Theme.spacingXS

                    StyledText {
                        anchors.verticalCenter: parent.verticalCenter
                        text: card.entry ? I18n.trFor("timeTracker", "Started at %1").arg(Tracker.formatClock(card.entry.start)) : ""
                        font.pixelSize: Theme.fontSizeSmall
                        color: Theme.surfaceVariantText

                        MouseArea {
                            anchors.fill: parent
                            enabled: card.caps.editRunningEntry === true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.editingStart = true
                        }
                    }

                    DIcon {
                        visible: card.caps.editRunningEntry === true
                        anchors.verticalCenter: parent.verticalCenter
                        name: "edit"
                        size: Theme.iconSizeSmall - 2
                        color: Theme.surfaceVariantText
                    }
                }

                DTextField {
                    id: startField

                    visible: card.editingStart
                    width: 120
                    placeholderText: "HH:MM"
                    onVisibleChanged: {
                        if (visible) {
                            text = card.entry ? Tracker.formatClock(card.entry.start) : "";
                            forceActiveFocus();
                            selectAll();
                        }
                    }
                    onAccepted: card.commitStart(text)
                    onFocusStateChanged: hasFocus => {
                        if (!hasFocus && card.editingStart)
                            card.commitStart(text);
                    }
                }
            }

            Row {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                spacing: Theme.spacingS

                DIconButton {
                    visible: card.running
                    anchors.verticalCenter: parent.verticalCenter
                    iconName: card.confirmDiscard ? "delete_forever" : "delete"
                    iconColor: card.confirmDiscard ? Theme.error : Theme.surfaceVariantText
                    tooltipText: card.confirmDiscard ? I18n.trFor("timeTracker", "Click again to discard the timer") : I18n.trFor("timeTracker", "Discard timer")
                    onClicked: {
                        if (!card.confirmDiscard) {
                            card.confirmDiscard = true;
                            discardReset.restart();
                            return;
                        }
                        card.confirmDiscard = false;
                        card.report(card.service.deleteEntry(card.entry.id));
                    }
                }

                DButton {
                    id: startStop

                    anchors.verticalCenter: parent.verticalCenter
                    text: card.running ? I18n.trFor("timeTracker", "Stop") : I18n.trFor("timeTracker", "Start")
                    iconName: card.running ? "stop" : "play_arrow"
                    danger: card.running
                    busy: card.service ? card.service.busy : false
                    enabled: card.service && card.service.ready
                    onClicked: card.startStop()
                }
            }
        }

        StyledText {
            width: parent.width
            visible: card.message !== ""
            text: card.message
            color: Theme.error
            font.pixelSize: Theme.fontSizeSmall
            wrapMode: Text.WordWrap
        }
    }
}
