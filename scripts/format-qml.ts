// Formats QML with qmlformat (settings in .qmlformat.ini).
//
//   node scripts/format-qml.ts            # rewrite files in place
//   node scripts/format-qml.ts --check    # exit 1 if any file would change
//   node scripts/format-qml.ts [--check] files...

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = [".", "ui", "lib", "tests/qml"];

function findQmlformat(): string {
    if (process.env.QMLFORMAT) return process.env.QMLFORMAT;
    for (const candidate of ["qmlformat", "qmlformat6", "/usr/lib/qt6/bin/qmlformat"]) {
        try {
            return execFileSync("sh", ["-c", `command -v ${candidate}`], { encoding: "utf8" }).trim();
        } catch {
            // try next
        }
    }
    throw new Error("qmlformat not found (Qt 6 qtdeclarative; provided by `nix develop`)");
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const explicit = args.filter(a => a !== "--check");
const files =
    explicit.length > 0
        ? explicit
        : DIRS.flatMap(dir =>
              readdirSync(join(ROOT, dir))
                  .filter(name => name.endsWith(".qml"))
                  .map(name => join(dir, name))
          );

const qmlformat = findQmlformat();
const unformatted: string[] = [];

for (const file of files) {
    const path = join(ROOT, file);
    if (check) {
        const result = spawnSync(qmlformat, [path], { cwd: ROOT, encoding: "utf8" });
        if (result.status !== 0) {
            console.error(result.stderr);
            process.exit(1);
        }
        if (result.stdout !== readFileSync(path, "utf8")) unformatted.push(relative(ROOT, path));
    } else {
        execFileSync(qmlformat, ["-i", path], { cwd: ROOT });
    }
}

if (unformatted.length) {
    console.error(`qmlformat: ${unformatted.length} file(s) need formatting (run npm run format):\n  ${unformatted.join("\n  ")}`);
    process.exit(1);
}
console.log(check ? `qmlformat: ${files.length} file(s) formatted correctly.` : `qmlformat: formatted ${files.length} file(s).`);
