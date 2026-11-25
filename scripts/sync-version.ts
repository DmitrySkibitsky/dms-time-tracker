// Copies the version from package.json (bumped by changelogen) into plugin.json, the file DMS
// reads. `npm run check:manifest` fails if the two ever differ.
//
//   node scripts/sync-version.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const manifestPath = join(ROOT, "plugin.json");
const source = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(source) as { version: string };

if (manifest.version === version) {
    console.log(`plugin.json already at ${version}`);
} else {
    // Replace only the version line so the manifest keeps its formatting.
    const updated = source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
    writeFileSync(manifestPath, updated);
    console.log(`plugin.json: ${manifest.version} -> ${version}`);
}
