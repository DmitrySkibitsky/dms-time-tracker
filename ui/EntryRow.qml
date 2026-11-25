pragma ComponentBehavior: Bound

import QtQuick
import qs.Common
import qs.DCommon.Widgets
import "../lib/tracker.mjs" as Tracker

// One finished entry in the history list. Hover reveals continue / edit / delete.
Item {
    id: row

    required property var entry
    required property var texts

    signal continueRequested
    signal editRequested
    signal deleteRequested

    property bool confirmDelete: false
    readonly property bool hovered: hover.hovered

    readonly property string subtitle: {
        const parts = [];
        if (entry.projectName)
            parts.push(entry.clientName ? entry.projectName + " (" + entry.clientName + ")" : entry.projectName);
        if (entry.taskName)
            parts.push(entry.taskName);
        if (entry.tagNames.length)
            parts.push("#" + entry.tagNames.join(" #"));
        return parts.join("  ·  ");
    }

    width: parent ? parent.width : 0
    height: Math.max(Theme.listItemHeight + Theme.spacingS, textColumn.implicitHeight + Theme.spacingS * 2)

    HoverHandler {
        id: hover
        onHoveredChanged: {
            if (!hovered)
                row.confirmDelete = false;
        }
    }

    Rectangle {
        anchors.fill: parent
        radius: Theme.cornerRadiusS
        color: row.hovered ? Theme.chipSurface : "transparent"
    }

    MouseArea {
        anchors.fill: parent
        cursorShape: Qt.PointingHandCursor
        onClicked: row.editRequested()
    }

    Rectangle {
        id: dot
        anchors.left: parent.left
        anchors.leftMargin: Theme.spacingS
        anchors.verticalCenter: parent.verticalCenter
        width: 8
        height: 8
        radius: 4
        color: row.entry.projectColor || Theme.outline
    }

    Column {
        id: textColumn

        anchors.left: dot.right
        anchors.leftMargin: Theme.spacingS
        anchors.right: trailing.left
        anchors.rightMargin: Theme.spacingS
        anchors.verticalCenter: parent.verticalCenter
        spacing: 2

        StyledText {
            width: parent.width
            text: row.entry.description || row.texts.noDescription()
            elide: Text.ElideRight
            // StyledText word-wraps by default; a single line is what elide needs.
            wrapMode: Text.NoWrap
            color: row.entry.description ? Theme.surfaceText : Theme.surfaceVariantText
            font.pixelSize: Theme.fontSizeMedium
        }

        StyledText {
            width: parent.width
            visible: text !== ""
            text: row.subtitle
            elide: Text.ElideRight
            // StyledText word-wraps by default; a single line is what elide needs.
            wrapMode: Text.NoWrap
            color: Theme.surfaceVariantText
            font.pixelSize: Theme.fontSizeSmall
        }
    }

    Item {
        id: trailing

        anchors.right: parent.right
        anchors.rightMargin: Theme.spacingS
        anchors.verticalCenter: parent.verticalCenter
        width: Math.max(times.implicitWidth, actions.implicitWidth)
        height: Math.max(times.implicitHeight, actions.implicitHeight)

        Column {
            id: times
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            visible: !row.hovered
            spacing: 2

            StyledText {
                anchors.right: parent.right
                text: Tracker.formatDuration(row.entry.duration)
                color: Theme.surfaceText
                font.pixelSize: Theme.fontSizeMedium
            }

            Row {
                anchors.right: parent.right
                spacing: Theme.spacingXS

                DIcon {
                    visible: row.entry.billable
                    name: "attach_money"
                    size: Theme.iconSizeSmall - 2
                    color: Theme.surfaceVariantText
                    anchors.verticalCenter: parent.verticalCenter
                }

                StyledText {
                    text: Tracker.formatClock(row.entry.start) + " – " + Tracker.formatClock(row.entry.end)
                    color: Theme.surfaceVariantText
                    font.pixelSize: Theme.fontSizeSmall
                }
            }
        }

        Row {
            id: actions
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            visible: row.hovered
            spacing: 0

            DIconButton {
                iconName: "play_arrow"
                tooltipText: I18n.trFor("timeTracker", "Continue")
                onClicked: row.continueRequested()
            }

            DIconButton {
                iconName: "edit"
                tooltipText: I18n.trFor("timeTracker", "Edit")
                onClicked: row.editRequested()
            }

            DIconButton {
                iconName: row.confirmDelete ? "delete_forever" : "delete"
                iconColor: row.confirmDelete ? Theme.error : Theme.surfaceVariantText
                tooltipText: row.confirmDelete ? I18n.trFor("timeTracker", "Click again to delete") : I18n.trFor("timeTracker", "Delete")
                onClicked: {
                    if (!row.confirmDelete) {
                        row.confirmDelete = true;
                        return;
                    }
                    row.confirmDelete = false;
                    row.deleteRequested();
                }
            }
        }
    }
}
