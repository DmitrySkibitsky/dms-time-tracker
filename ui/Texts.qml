pragma ComponentBehavior: Bound

import QtQuick
import qs.Common

// Translated strings shared by several components. The plugin id passed to I18n.trFor
// must stay a literal so the translation tooling can extract the strings.
QtObject {
    // Validation codes are shown inline by forms; daemon toasts skip them.
    readonly property var validationCodes: ["missing-start", "missing-end", "end-before-start", "missing-project", "missing-task", "missing-description", "missing-tags", "start-in-future", "invalid-date", "invalid-start", "invalid-end", "zero-length"]

    function isValidation(code) {
        return validationCodes.indexOf(code) !== -1;
    }

    // Human message for an ActionResult / error code; falls back to the service's message.
    function error(code, message) {
        switch (code) {
        case "missing-start":
        case "invalid-start":
            return I18n.trFor("timeTracker", "Enter a valid start time");
        case "missing-end":
            return I18n.trFor("timeTracker", "Enter an end time");
        case "invalid-end":
            return I18n.trFor("timeTracker", "Enter a valid end time");
        case "invalid-date":
            return I18n.trFor("timeTracker", "Enter the date as YYYY-MM-DD");
        case "zero-length":
        case "end-before-start":
            return I18n.trFor("timeTracker", "The end must be after the start");
        case "start-in-future":
            return I18n.trFor("timeTracker", "The start time can't be in the future");
        case "missing-project":
            return I18n.trFor("timeTracker", "This workspace requires a project");
        case "missing-task":
            return I18n.trFor("timeTracker", "This workspace requires a task");
        case "missing-description":
            return I18n.trFor("timeTracker", "This workspace requires a description");
        case "missing-tags":
            return I18n.trFor("timeTracker", "This workspace requires at least one tag");
        case "not-running":
            return I18n.trFor("timeTracker", "No timer is running");
        case "not-ready":
            return I18n.trFor("timeTracker", "Not connected to the time tracking service");
        case "not-found":
            return I18n.trFor("timeTracker", "The entry no longer exists");
        case "auth":
            return I18n.trFor("timeTracker", "Authentication failed: check the API key");
        case "network":
            return I18n.trFor("timeTracker", "The service is unreachable");
        case "rate-limit":
            return I18n.trFor("timeTracker", "Too many requests, try again later");
        default:
            return message || I18n.trFor("timeTracker", "Something went wrong");
        }
    }

    // Calendar date of a day group, e.g. "Wed, 25 Nov" (localized by Qt).
    function dayDate(group) {
        return Qt.formatDate(new Date(group.dayStart), "ddd, d MMM");
    }

    function dayLabel(group) {
        if (group.daysAgo === 0)
            return I18n.trFor("timeTracker", "Today");
        if (group.daysAgo === 1)
            return I18n.trFor("timeTracker", "Yesterday");
        return Qt.formatDate(new Date(group.dayStart), "ddd, d MMM");
    }

    function noDescription() {
        return I18n.trFor("timeTracker", "(no description)");
    }

    function noProject() {
        return I18n.trFor("timeTracker", "No project");
    }

    function noTask() {
        return I18n.trFor("timeTracker", "No task");
    }
}
