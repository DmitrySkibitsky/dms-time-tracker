// Lints the plugin's QML with qmllint against the real DMS and Quickshell modules.
// Fails on any warning except known issues in third-party type files (see IGNORED).
//
//   node scripts/lint-qml.ts [files...]

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { prepare } from "./qml-env.ts";

const ROOT = new URL("..", import.meta.url).pathname;

interface Warning {
    type: string;
    id?: string;
    line?: number;
    column?: number;
    message: string;
}

interface FileResult {
    filename: string;
    success: boolean;
    warnings: Warning[];
}

// Messages caused by the environment, not by the plugin.
const IGNORED: RegExp[] = [
    // Quickshell's generated qmltypes use a key newer than some qmllint releases know.
    /qmltypes:\d+:\d+: Expected only .* not "isTypeOpaque"/,
    /Warnings occurred while importing module "Quickshell(\.[A-Za-z]+)?":/
];

function findQmllint(): string {
    const fromEnv = process.env.QMLLINT;
    if (fromEnv) return fromEnv;
    for (const candidate of ["qmllint", "qmllint6", "/usr/lib/qt6/bin/qmllint"]) {
        try {
            return execFileSync("sh", ["-c", `command -v ${candidate}`], { encoding: "utf8" }).trim();
        } catch {
            // try next
        }
    }
    throw new Error("qmllint not found (Qt 6 qtdeclarative; provided by `nix develop`)");
}

function pluginQmlFiles(): string[] {
    const files: string[] = [];
    for (const dir of [".", "ui", "lib"]) {
        for (const name of readdirSync(join(ROOT, dir))) {
            if (name.endsWith(".qml")) files.push(join(dir, name));
        }
    }
    return files;
}

const qmllint = findQmllint();
const qtQml = join(dirname(dirname(realpathSync(qmllint))), "lib/qt-6/qml");
const imports = [...prepare(), qtQml].flatMap(path => ["-I", path]);
const files = process.argv.length > 2 ? process.argv.slice(2) : pluginQmlFiles();

const outDir = mkdtempSync(join(tmpdir(), "qmllint-"));
const jsonFile = join(outDir, "report.json");
spawnSync(qmllint, [...imports, "--json", jsonFile, ...files], { cwd: ROOT, encoding: "utf8" });
const report = JSON.parse(readFileSync(jsonFile, "utf8")) as { files: FileResult[] };
rmSync(outDir, { recursive: true, force: true });

let count = 0;
for (const file of report.files) {
    for (const w of file.warnings) {
        if (w.type === "info" || IGNORED.some(re => re.test(w.message))) continue;
        count++;
        const where = `${relative(ROOT, file.filename)}:${w.line ?? 0}:${w.column ?? 0}`;
        console.log(`${where}: ${w.type}: ${w.message}${w.id ? ` [${w.id}]` : ""}`);
    }
}

if (count > 0) {
    console.error(`\nqmllint: ${count} warning(s) in ${files.length} file(s).`);
    process.exit(1);
}
console.log(`qmllint: ${files.length} file(s) clean.`);
