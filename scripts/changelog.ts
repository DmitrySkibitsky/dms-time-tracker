// Release helper behind `npm run changelog`: bumps the version and writes the CHANGELOG section
// with changelogen, then copies the version to plugin.json.
//
//   npm run changelog                 # version from the commits since the last tag
//   npm run changelog -- -r 0.2.0     # name the version
//
// A wrapper rather than `changelogen --bump && node scripts/sync-version.ts` in package.json: npm
// appends the arguments to the end of the whole script, so `-r 0.2.0` would reach the sync step
// instead of changelogen.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

/** The version given with `-r X.Y.Z` / `-r=X.Y.Z`, if any. */
function requestedVersion(args: string[]): string | null {
    for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? "";
        if (arg === "-r") return args[i + 1] ?? null;
        if (arg.startsWith("-r=")) return arg.slice(3);
    }
    return null;
}

const args = process.argv.slice(2);
const current = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
// changelogen refuses to "bump" to the version package.json already has (e.g. the first release,
// 0.1.0): then only the CHANGELOG section is written (without --bump it needs an explicit --output).
const bump = requestedVersion(args) !== current;
run(join(ROOT, "node_modules/.bin/changelogen"), [...(bump ? ["--bump"] : ["--output", "CHANGELOG.md"]), ...args]);
run(process.execPath, [join(ROOT, "scripts/sync-version.ts")]);
