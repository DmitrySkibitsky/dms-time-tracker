import assert from "node:assert/strict";
import { test } from "node:test";
import * as Time from "../../src/core/time.ts";

// npm scripts and CI pin TZ=UTC; local-time helpers are built with the same zone.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test("parseIsoDuration handles ISO-8601 durations", () => {
    assert.equal(Time.parseIsoDuration("PT1H2M3S"), 3723);
    assert.equal(Time.parseIsoDuration("PT45M"), 2700);
    assert.equal(Time.parseIsoDuration("PT30S"), 30);
    assert.equal(Time.parseIsoDuration("P1DT1H"), 90000);
    assert.equal(Time.parseIsoDuration("PT0S"), 0);
    for (const bad of ["", null, undefined, "garbage"]) assert.equal(Time.parseIsoDuration(bad), 0);
});

test("formatDuration", () => {
    assert.equal(Time.formatDuration(0), "0:00:00");
    assert.equal(Time.formatDuration(59), "0:00:59");
    assert.equal(Time.formatDuration(3723), "1:02:03");
    assert.equal(Time.formatDuration(108000), "30:00:00");
    assert.equal(Time.formatDuration(3723, false), "1:02");
    assert.equal(Time.formatDuration(-5), "0:00:00");
    assert.equal(Time.formatDuration(Number.NaN), "0:00:00");
});

test("toIso drops milliseconds; parseIso round-trips", () => {
    assert.equal(Time.toIso(Date.UTC(2024, 4, 1, 9, 30, 15, 789)), "2024-05-01T09:30:15Z");
    assert.equal(Time.parseIso("2024-05-01T09:30:15Z"), Date.UTC(2024, 4, 1, 9, 30, 15));
    assert.equal(Time.parseIso(null), null);
    assert.equal(Time.parseIso("nope"), null);
});

test("calendar helpers", () => {
    const wednesday = local(2024, 5, 15, 13, 45);
    assert.equal(Time.startOfDay(wednesday), local(2024, 5, 15));
    assert.equal(Time.addDays(wednesday, -1), local(2024, 5, 14, 13, 45));
    assert.equal(Time.startOfWeek(wednesday), local(2024, 5, 13));
    assert.equal(Time.startOfWeek(wednesday, 0), local(2024, 5, 12));
    assert.equal(Time.startOfWeek(local(2024, 5, 13, 8)), local(2024, 5, 13));
    assert.equal(Time.startOfWeek(local(2024, 5, 19, 8)), local(2024, 5, 13), "Sunday belongs to the Monday week");
    assert.equal(Time.dayKey(wednesday), "2024-05-15");
    assert.equal(Time.daysAgo(local(2024, 5, 14, 23), wednesday), 1);
    assert.equal(Time.daysAgo(wednesday, wednesday), 0);
    assert.equal(Time.formatClock(local(2024, 5, 15, 7, 5)), "07:05");
});

test("parseClock accepts typed formats", () => {
    const cases: [string, number, number][] = [
        ["9", 9, 0],
        ["930", 9, 30],
        ["0930", 9, 30],
        ["09:30", 9, 30],
        ["9.30", 9, 30],
        [" 21:05 ", 21, 5],
        ["9:30pm", 21, 30],
        ["12am", 0, 0],
        ["12 PM", 12, 0],
        ["0:00", 0, 0]
    ];
    for (const [input, hour, minute] of cases) assert.deepEqual(Time.parseClock(input), { hour, minute }, input);
    for (const bad of ["", "24:00", "9:60", "13pm", "abc", "1:2", null, undefined]) assert.equal(Time.parseClock(bad), null, String(bad));
});

test("parseDateKey validates calendar dates", () => {
    assert.deepEqual(Time.parseDateKey("2024-02-29"), { year: 2024, month: 2, day: 29 });
    assert.equal(Time.parseDateKey("2023-02-29"), null);
    assert.equal(Time.parseDateKey("2024-13-01"), null);
    assert.equal(Time.parseDateKey("01.02.2024"), null);
});

test("resolveRange", () => {
    assert.deepEqual(Time.resolveRange("2024-05-15", "9:00", "10:30"), {
        start: local(2024, 5, 15, 9),
        end: local(2024, 5, 15, 10, 30),
        error: ""
    });
    assert.equal(Time.resolveRange("2024-05-15", "22:00", "01:00").end, local(2024, 5, 16, 1), "overnight");
    assert.deepEqual(Time.resolveRange("2024-05-15", "9:00", "", true), { start: local(2024, 5, 15, 9), end: null, error: "" });
    assert.equal(Time.resolveRange("2024-05-15", "9:00", "").error, "missing-end");
    assert.equal(Time.resolveRange("bad", "9:00", "10:00").error, "invalid-date");
    assert.equal(Time.resolveRange("2024-05-15", "x", "10:00").error, "invalid-start");
    assert.equal(Time.resolveRange("2024-05-15", "9:00", "y").error, "invalid-end");
    assert.equal(Time.resolveRange("2024-05-15", "9:00", "9:00").error, "zero-length");
});

test("parseDurationInput", () => {
    const cases: [string, number][] = [
        ["1:30", 5400],
        ["1:30:15", 5415],
        ["1h30m", 5400],
        ["1.5h", 5400],
        ["1,5h", 5400],
        ["90m", 5400],
        ["45", 2700]
    ];
    for (const [input, seconds] of cases) assert.equal(Time.parseDurationInput(input), seconds, input);
    for (const bad of ["", "1:75", "soon", null]) assert.equal(Time.parseDurationInput(bad), null, String(bad));
});
