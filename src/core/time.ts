// Time helpers. Local-time functions use the process/shell time zone.

export const MS_PER_DAY = 86_400_000;

export interface Clock {
    hour: number;
    minute: number;
}

export interface DateParts {
    year: number;
    month: number;
    day: number;
}

export type RangeError = "" | "invalid-date" | "invalid-start" | "invalid-end" | "missing-end" | "zero-length";

export interface ResolvedRange {
    start: number | null;
    end: number | null;
    error: RangeError;
}

export function pad2(n: number): string {
    const v = Math.floor(Math.abs(n));
    return v < 10 ? `0${v}` : String(v);
}

/** ISO-8601 duration ("PT1H2M3S", "P1DT2H") to seconds; 0 for empty or malformed input. */
export function parseIsoDuration(text: string | null | undefined): number {
    if (!text) return 0;
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text.trim());
    if (!m) return 0;
    return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Math.floor(Number(m[4] ?? 0));
}

/** Seconds to "1:02:03" (or "1:02" without seconds). */
export function formatDuration(seconds: number, withSeconds = true): string {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return withSeconds ? `${h}:${pad2(m)}:${pad2(s)}` : `${h}:${pad2(m)}`;
}

/** Epoch ms to "2024-05-01T09:30:00Z" (whole seconds, UTC). */
export function toIso(ms: number): string {
    return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** ISO string to epoch ms, or null when missing/invalid. */
export function parseIso(text: string | null | undefined): number | null {
    if (!text) return null;
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : ms;
}

export function startOfDay(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function addDays(ms: number, days: number): number {
    const d = new Date(ms);
    d.setDate(d.getDate() + days);
    return d.getTime();
}

/** weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(ms: number, weekStart = 1): number {
    const day = startOfDay(ms);
    const diff = (new Date(day).getDay() - weekStart + 7) % 7;
    return addDays(day, -diff);
}

/** Local calendar day "YYYY-MM-DD". */
export function dayKey(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Calendar days between the day of ms and the day of now (0 = today, 1 = yesterday). */
export function daysAgo(ms: number, now: number): number {
    return Math.round((startOfDay(now) - startOfDay(ms)) / MS_PER_DAY);
}

/** Epoch ms to local "HH:MM". */
export function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parses typed clock times: "9", "930", "09:30", "9.30", "9:30pm", "12am". */
export function parseClock(text: string | null | undefined): Clock | null {
    if (text === null || text === undefined) return null;
    const t = String(text).trim().toLowerCase().replace(/\s+/g, "");
    const m = /^(\d{1,2})(?:[:.](\d{2})|(\d{2}))?(am|pm|a|p)?$/.exec(t);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = Number(m[2] ?? m[3] ?? 0);
    const suffix = m[4]?.charAt(0) ?? "";
    if (suffix) {
        if (hour < 1 || hour > 12) return null;
        if (suffix === "a") hour = hour === 12 ? 0 : hour;
        else hour = hour === 12 ? 12 : hour + 12;
    }
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
}

/** "YYYY-MM-DD" to parts, rejecting impossible dates. */
export function parseDateKey(text: string | null | undefined): DateParts | null {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(text ?? "").trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return { year, month, day };
}

/** Local date + clock to epoch ms. */
export function combine(dateText: string, clock: Clock): number | null {
    const d = parseDateKey(dateText);
    if (!d) return null;
    return new Date(d.year, d.month - 1, d.day, clock.hour, clock.minute, 0, 0).getTime();
}

/**
 * Editor text to an interval. An end earlier than the start rolls over to the next day.
 * An empty end is accepted only when allowOpenEnd (running timer).
 */
export function resolveRange(dateText: string, startText: string, endText: string, allowOpenEnd = false): ResolvedRange {
    if (!parseDateKey(dateText)) return { start: null, end: null, error: "invalid-date" };
    const startClock = parseClock(startText);
    if (!startClock) return { start: null, end: null, error: "invalid-start" };
    const start = combine(dateText, startClock) as number;
    if (String(endText ?? "").trim() === "")
        return allowOpenEnd ? { start, end: null, error: "" } : { start, end: null, error: "missing-end" };
    const endClock = parseClock(endText);
    if (!endClock) return { start, end: null, error: "invalid-end" };
    let end = combine(dateText, endClock) as number;
    if (end < start) end = combine(dayKey(addDays(start, 1)), endClock) as number;
    if (end === start) return { start, end, error: "zero-length" };
    return { start, end, error: "" };
}

/** Typed durations: "1:30", "1:30:15", "1h30m", "1.5h", "90m", "45" (minutes). */
export function parseDurationInput(text: string | null | undefined): number | null {
    const t = String(text ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    if (t === "") return null;
    let m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
    if (m) {
        if (Number(m[2]) > 59 || Number(m[3] ?? 0) > 59) return null;
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
    }
    m = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)m)?$/.exec(t);
    if (m && (m[1] || m[2])) return Math.round(Number((m[1] ?? "0").replace(",", ".")) * 3600) + Number(m[2] ?? 0) * 60;
    if (/^\d+$/.test(t)) return Number(t) * 60;
    return null;
}
