pragma ComponentBehavior: Bound

import QtQuick
import qs.Common
import qs.DCommon.Widgets
import "../lib/tracker.mjs" as Tracker

// Form for a finished entry: edit an existing one or add time manually.
Item {
    id: editor

    required property var service
    required property var texts
    // Entry being edited, or null to create a new one.
    property var entry: null

    signal closed

    readonly property bool isNew: entry === null
    readonly property var trackerState: service ? service.snapshot : null
    readonly property var caps: trackerState ? trackerState.capabilities : ({})
    readonly property var requirements: trackerState ? trackerState.requirements : ({})

    // Editable copy of the entry's fields.
    property string projectId: ""
    property string taskId: ""
    property var tagIds: []
    property bool billable: false

    readonly property var tasks: projectId && trackerState && trackerState.tasks[projectId] ? trackerState.tasks[projectId] : []
    readonly property var range: Tracker.resolveRange(dateField.text, startField.text, endField.text, false)
    property string message: ""
    property bool saving: false
    property bool confirmDelete: false

    function load() {
        const now = Date.now();
        const source = entry;
        descField.text = source ? source.description : "";
        projectId = source && source.projectId ? source.projectId : (trackerState && trackerState.draft.projectId ? trackerState.draft.projectId : "");
        taskId = source && source.taskId ? source.taskId : "";
        tagIds = source ? source.tagIds.slice() : [];
        // New entries start with the remembered billable default (the draft carries it).
        billable = source ? source.billable : !!(trackerState && trackerState.draft.billable);
        // New entries default to the hour before now.
        const start = source ? source.start : now - 3600000;
        const end = source ? source.end : now;
        dateField.text = Tracker.dayKey(start);
        startField.text = Tracker.formatClock(start);
        endField.text = Tracker.formatClock(end);
        message = "";
        if (projectId)
            service.loadTasks(projectId);
    }

    function draft() {
        return {
            description: descField.text,
            projectId: projectId || null,
            taskId: taskId || null,
            tagIds: tagIds.slice(),
            billable: billable,
            start: range.start,
            end: range.end
        };
    }

    function finish(promise) {
        saving = true;
        promise.then(result => {
            editor.saving = false;
            if (result.ok)
                editor.closed();
            else
                editor.message = editor.texts.error(result.code, result.error);
        });
    }

    function save() {
        if (range.error) {
            message = texts.error(range.error, "");
            return;
        }
        finish(isNew ? service.createEntry(draft()) : service.updateEntry(entry.id, draft()));
    }

    // Typing a duration moves the end time.
    function applyDuration(text) {
        const seconds = Tracker.parseDurationInput(text);
        if (seconds === null || range.start === null) {
            durationField.text = range.error ? "" : Tracker.formatDuration((range.end - range.start) / 1000, false);
            return;
        }
        endField.text = Tracker.formatClock(range.start + seconds * 1000);
    }

    Component.onCompleted: load()
    onEntryChanged: load()

    // DFlickable: the shell's flickable with a scrollbar.
    DFlickable {
        anchors.fill: parent
        contentHeight: form.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: form

            width: parent.width
            spacing: Theme.spacingM

            StyledText {
                text: editor.isNew ? I18n.trFor("timeTracker", "Add time entry") : I18n.trFor("timeTracker", "Edit time entry")
                font.pixelSize: Theme.fontSizeLarge
                font.weight: Font.Medium
                color: Theme.surfaceText
            }

            DTextField {
                id: descField
                width: parent.width
                labelText: I18n.trFor("timeTracker", "Description")
                onAccepted: editor.save()
            }

            DDropdown {
                visible: editor.caps.projects === true
                width: parent.width
                text: I18n.trFor("timeTracker", "Project")
                enableFuzzySearch: true
                readonly property var opts: Tracker.projectOptions(editor.trackerState ? editor.trackerState.projects : [], editor.texts.noProject())
                options: opts.labels
                optionValues: opts.values
                emptyText: I18n.trFor("timeTracker", "Project")
                Binding on currentValue {
                    value: editor.projectId
                }
                onValueChanged: value => {
                    if (value === editor.projectId)
                        return;
                    editor.projectId = value;
                    editor.taskId = "";
                    if (value)
                        editor.service.loadTasks(value);
                }
            }

            DDropdown {
                visible: editor.caps.tasks === true && editor.tasks.length > 0
                width: parent.width
                text: I18n.trFor("timeTracker", "Task")
                enableFuzzySearch: true
                readonly property var opts: Tracker.taskOptions(editor.tasks, editor.texts.noTask())
                options: opts.labels
                optionValues: opts.values
                emptyText: I18n.trFor("timeTracker", "Task")
                Binding on currentValue {
                    value: editor.taskId
                }
                onValueChanged: value => editor.taskId = value
            }

            Column {
                width: parent.width
                spacing: Theme.spacingXS
                visible: editor.caps.tags === true && editor.trackerState && editor.trackerState.tags.length > 0

                StyledText {
                    text: I18n.trFor("timeTracker", "Tags")
                    font.pixelSize: Theme.fontSizeSmall
                    color: Theme.surfaceVariantText
                }

                TagPicker {
                    width: parent.width
                    tags: editor.trackerState ? editor.trackerState.tags : []
                    selectedIds: editor.tagIds
                    onEdited: ids => editor.tagIds = ids
                }
            }

            DToggle {
                visible: editor.caps.billable === true
                width: parent.width
                text: I18n.trFor("timeTracker", "Billable")
                Binding on checked {
                    value: editor.billable
                }
                onToggled: checked => editor.billable = checked
            }

            Row {
                width: parent.width
                spacing: Theme.spacingS
                readonly property real fieldWidth: (width - spacing * 3) / 4

                DTextField {
                    id: dateField
                    width: parent.fieldWidth * 1.3
                    labelText: I18n.trFor("timeTracker", "Date")
                    placeholderText: "YYYY-MM-DD"
                    isError: editor.range.error === "invalid-date"
                }

                DTextField {
                    id: startField
                    width: parent.fieldWidth * 0.9
                    labelText: I18n.trFor("timeTracker", "Start")
                    placeholderText: "HH:MM"
                    isError: editor.range.error === "invalid-start"
                }

                DTextField {
                    id: endField
                    width: parent.fieldWidth * 0.9
                    labelText: I18n.trFor("timeTracker", "End")
                    placeholderText: "HH:MM"
                    isError: ["invalid-end", "missing-end", "zero-length"].indexOf(editor.range.error) !== -1
                }

                DTextField {
                    id: durationField
                    width: parent.fieldWidth * 0.9
                    labelText: I18n.trFor("timeTracker", "Duration")
                    placeholderText: "1:30"
                    text: editor.range.error ? "" : Tracker.formatDuration((editor.range.end - editor.range.start) / 1000, false)
                    onEditingFinished: editor.applyDuration(text)
                }
            }

            StyledText {
                width: parent.width
                visible: editor.message !== ""
                text: editor.message
                color: Theme.error
                font.pixelSize: Theme.fontSizeSmall
                wrapMode: Text.WordWrap
            }

            Item {
                width: parent.width
                height: buttons.implicitHeight

                Row {
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    visible: !editor.isNew
                    spacing: 0

                    DIconButton {
                        iconName: editor.confirmDelete ? "delete_forever" : "delete"
                        iconColor: editor.confirmDelete ? Theme.error : Theme.surfaceVariantText
                        tooltipText: editor.confirmDelete ? I18n.trFor("timeTracker", "Click again to delete") : I18n.trFor("timeTracker", "Delete")
                        onClicked: {
                            if (!editor.confirmDelete) {
                                editor.confirmDelete = true;
                                return;
                            }
                            editor.finish(editor.service.deleteEntry(editor.entry.id));
                        }
                    }

                    DIconButton {
                        iconName: "content_copy"
                        tooltipText: I18n.trFor("timeTracker", "Duplicate")
                        onClicked: editor.finish(editor.service.duplicateEntry(editor.entry.id))
                    }
                }

                Row {
                    id: buttons
                    anchors.right: parent.right
                    spacing: Theme.spacingS

                    DButton {
                        text: I18n.trFor("timeTracker", "Cancel")
                        variant: "text"
                        onClicked: editor.closed()
                    }

                    DButton {
                        text: I18n.trFor("timeTracker", "Save")
                        iconName: "check"
                        busy: editor.saving
                        enabled: !editor.saving
                        onClicked: editor.save()
                    }
                }
            }
        }
    }
}
