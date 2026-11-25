// Validates plugin.json against the DMS manifest rules (PLUGINS/plugin-schema.json) and
// keeps it consistent with the code: plugin id, version, referenced files, permissions.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ID } from "../src/qml/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")) as Record<string, unknown>;
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

const problems: string[] = [];
const fail = (message: string) => problems.push(message);

for (const key of ["id", "name", "description", "version", "author", "type", "capabilities"]) {
    if (manifest[key] === undefined || manifest[key] === "") fail(`missing required field "${key}"`);
}

if (manifest.id !== PLUGIN_ID) fail(`id "${String(manifest.id)}" must equal PLUGIN_ID "${PLUGIN_ID}" (src/qml/index.ts)`);
if (typeof manifest.id === "string" && !/^[a-z][a-zA-Z0-9]*$/.test(manifest.id)) fail("id must be camelCase without spaces");
if (manifest.version !== pkg.version) fail(`version ${String(manifest.version)} differs from package.json ${pkg.version}`);
if (typeof manifest.version === "string" && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) fail("version must be semver");

const types = ["widget", "daemon", "launcher", "desktop", "dash", "dashCard", "composite"];
if (!types.includes(String(manifest.type))) fail(`type must be one of ${types.join(", ")}`);
if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) fail("capabilities must be a non-empty array");

const qmlPath = (label: string, value: unknown) => {
    if (typeof value !== "string" || !/^\.\/.*\.qml$/.test(value)) {
        fail(`${label} must look like "./File.qml"`);
        return;
    }
    if (!existsSync(join(ROOT, value))) fail(`${label} points to a missing file: ${value}`);
};

const components = manifest.components as Record<string, unknown> | undefined;
if (components) {
    const surfaces = ["widget", "desktop", "daemon", "launcher", "dash", "dashCard"];
    for (const [surface, path] of Object.entries(components)) {
        if (!surfaces.includes(surface)) fail(`unknown surface "${surface}" in components`);
        qmlPath(`components.${surface}`, path);
    }
} else {
    qmlPath("component", manifest.component);
}

if (manifest.settings !== undefined) {
    qmlPath("settings", manifest.settings);
    const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    if (!permissions.includes("settings_write")) fail('a settings component requires the "settings_write" permission');
}

if (typeof manifest.requires_dms === "string" && !/^(>=|>|<=|<|=)?\d+\.\d+\.\d+$/.test(manifest.requires_dms))
    fail('requires_dms must look like ">=2.0.0"');

for (const file of ["lib/tracker.mjs", "lib/TrackerService.qml"]) {
    if (!existsSync(join(ROOT, file))) fail(`runtime file missing: ${file} (run npm run build)`);
}

if (problems.length) {
    console.error(`plugin.json:\n  ${problems.join("\n  ")}`);
    process.exit(1);
}
console.log(`plugin.json OK (${String(manifest.id)} ${String(manifest.version)})`);
