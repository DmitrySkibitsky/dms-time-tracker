pragma ComponentBehavior: Bound

import QtQuick
import qs.Common
import qs.DCommon.Widgets

// Multi-select tag field for long tag lists: the field shows the selected tags as removable
// chips; clicking it expands an inline, searchable checklist (inline rather than a popup so it
// stays inside the popout's surface and focus).
Column {
    id: picker

    // All tags: [{id, name}].
    property var tags: []
    property var selectedIds: []
    property bool expanded: false
    property string placeholder: I18n.trFor("timeTracker", "Select tags")

    // Emitted with the complete new selection.
    signal edited(var ids)

    readonly property var selectedTags: tags.filter(t => selectedIds.indexOf(t.id) !== -1)
    readonly property var filtered: {
        const query = search.text.trim().toLowerCase();
        return query ? tags.filter(t => t.name.toLowerCase().indexOf(query) !== -1) : tags;
    }

    function toggle(id) {
        const next = selectedIds.filter(x => x !== id);
        if (next.length === selectedIds.length)
            next.push(id);
        edited(next);
    }

    function open() {
        expanded = true;
        search.forceActiveFocus();
    }

    function close() {
        expanded = false;
        search.text = "";
    }

    spacing: Theme.spacingXS

    Rectangle {
        id: field

        width: parent.width
        height: Math.max(Theme.listItemHeight, chips.implicitHeight + Theme.spacingS * 2)
        radius: Theme.cornerRadius
        color: Theme.chipSurface
        border.width: picker.expanded ? 2 : 0
        border.color: Theme.primary

        // Below the chips so a chip's remove button wins.
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: picker.expanded ? picker.close() : picker.open()
        }

        DIcon {
            id: tagIcon
            anchors.left: parent.left
            anchors.leftMargin: Theme.spacingS
            anchors.verticalCenter: parent.verticalCenter
            name: "sell"
            size: Theme.iconSizeSmall
            color: picker.selectedTags.length > 0 ? Theme.primary : Theme.surfaceVariantText
        }

        Flow {
            id: chips

            anchors.left: tagIcon.right
            anchors.right: arrow.left
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Theme.spacingS
            anchors.rightMargin: Theme.spacingS
            spacing: Theme.spacingXS

            StyledText {
                visible: picker.selectedTags.length === 0
                text: picker.placeholder
                color: Theme.surfaceVariantText
                font.pixelSize: Theme.fontSizeMedium
            }

            Repeater {
                model: picker.selectedTags

                delegate: Rectangle {
                    id: chip

                    required property var modelData

                    width: chipRow.implicitWidth + Theme.spacingS * 2
                    height: 26
                    radius: height / 2
                    color: Theme.secondaryContainer

                    Row {
                        id: chipRow
                        anchors.centerIn: parent
                        spacing: 2

                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: chip.modelData.name
                            color: Theme.onSecondaryContainer
                            font.pixelSize: Theme.fontSizeSmall
                        }

                        DIcon {
                            anchors.verticalCenter: parent.verticalCenter
                            name: "close"
                            size: 14
                            color: Theme.onSecondaryContainer

                            MouseArea {
                                anchors.fill: parent
                                anchors.margins: -4
                                cursorShape: Qt.PointingHandCursor
                                onClicked: picker.toggle(chip.modelData.id)
                            }
                        }
                    }
                }
            }
        }

        DIcon {
            id: arrow
            anchors.right: parent.right
            anchors.rightMargin: Theme.spacingS
            anchors.verticalCenter: parent.verticalCenter
            name: picker.expanded ? "expand_less" : "expand_more"
            size: Theme.iconSize
            color: Theme.surfaceVariantText
        }
    }

    Rectangle {
        width: parent.width
        height: panel.implicitHeight + Theme.spacingS * 2
        visible: picker.expanded
        radius: Theme.cornerRadius
        color: Theme.chipSurface

        Column {
            id: panel

            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: Theme.spacingS
            spacing: Theme.spacingXS

            DTextField {
                id: search

                width: parent.width
                placeholderText: I18n.trFor("timeTracker", "Search tags")
                leftIconName: "search"
                showClearButton: true
                // Enter toggles the single match, so tags can be picked from the keyboard.
                onAccepted: {
                    if (picker.filtered.length === 1) {
                        picker.toggle(picker.filtered[0].id);
                        text = "";
                    }
                }
                Keys.onEscapePressed: picker.close()
            }

            DListView {
                id: list

                width: parent.width
                height: Math.min(contentHeight, 220)
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                model: picker.filtered

                delegate: Rectangle {
                    id: row

                    required property var modelData
                    readonly property bool selected: picker.selectedIds.indexOf(modelData.id) !== -1

                    width: list.width
                    height: 34
                    radius: Theme.cornerRadiusS
                    color: rowHover.hovered ? Theme.withAlpha(Theme.surfaceText, 0.08) : "transparent"

                    HoverHandler {
                        id: rowHover
                    }

                    Row {
                        anchors.left: parent.left
                        anchors.leftMargin: Theme.spacingS
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: Theme.spacingS

                        DIcon {
                            anchors.verticalCenter: parent.verticalCenter
                            name: row.selected ? "check_box" : "check_box_outline_blank"
                            size: Theme.iconSizeSmall + 2
                            color: row.selected ? Theme.primary : Theme.surfaceVariantText
                        }

                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: row.modelData.name
                            color: Theme.surfaceText
                            font.pixelSize: Theme.fontSizeMedium
                        }
                    }

                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: picker.toggle(row.modelData.id)
                    }
                }
            }

            StyledText {
                visible: picker.filtered.length === 0
                text: I18n.trFor("timeTracker", "No matching tags")
                color: Theme.surfaceVariantText
                font.pixelSize: Theme.fontSizeSmall
            }
        }
    }
}
