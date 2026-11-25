/**
 * Normalises array-like values coming from QML. Arrays stored in QML `var` properties (plugin
 * data, initial properties) can arrive as V4 sequence objects: they have `length` and indices
 * but `Array.isArray()` is false and array methods may be missing.
 */
export function toArray<T = unknown>(value: unknown): T[] {
    if (Array.isArray(value)) return value as T[];
    if (value && typeof value === "object" && typeof (value as { length?: unknown }).length === "number")
        return Array.prototype.slice.call(value) as T[];
    return [];
}
