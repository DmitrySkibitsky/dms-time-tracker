// Prepares QML tooling (qmllint, qmlls in editors) to resolve the shell's imports.
//
// DMS runs on Quickshell, which maps `import qs.Common` to <shell>/Common at runtime and
// synthesises the qmldir files. Static tools can't do that, so this script mirrors the DMS
// tree into .qml-env/qs/** with generated qmldir files (singletons included) and writes
// .qmlls.ini so qmlls (Zed, VS Code, Qt Creator) finds both the shell and Quickshell modules.
//
//   node scripts/qml-env.ts            # prints the import paths
//
// Locations come from $DMS_SHELL_DIR and $QUICKSHELL_QML_DIR (set by `nix develop`) or are
// detected from the `dms` binary on PATH.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ENV_DIR = join(ROOT, ".qml-env");
const SKIP = new Set(["PLUGINS", "assets", "translations", "matugen", "scripts", "Shaders", "wallpaper-patterns"]);

function which(binary: string): string | null {
    try {
        return execFileSync("sh", ["-c", `command -v ${binary}`], { encoding: "utf8" }).trim() || null;
    } catch {
        return null;
    }
}

function findDms(): string {
    const fromEnv = process.env.DMS_SHELL_DIR;
    if (fromEnv && existsSync(join(fromEnv, "shell.qml"))) return fromEnv;
    const bin = which("dms");
    if (bin) {
        const shell = join(dirname(dirname(realpathSync(bin))), "share/quickshell/dms");
        if (existsSync(join(shell, "shell.qml"))) return shell;
    }
    throw new Error("DMS shell sources not found: set DMS_SHELL_DIR or run inside `nix develop`");
}

function versionOf(storePath: string): string {
    return storePath.split("-quickshell-")[1] ?? "";
}

function findQuickshell(dms: string): string {
    const fromEnv = process.env.QUICKSHELL_QML_DIR;
    if (fromEnv && existsSync(join(fromEnv, "Quickshell"))) return fromEnv;
    // The nix-built dms package references its quickshell.
    try {
        const pkg = dirname(dirname(dirname(dms)));
        const refs = execFileSync("nix-store", ["-q", "--references", pkg], { encoding: "utf8" }).split("\n");
        for (const ref of refs) {
            const qml = join(ref, "lib/qt-6/qml");
            if (ref.includes("quickshell") && existsSync(join(qml, "Quickshell"))) return qml;
        }
    } catch {
        // not a nix store path
    }
    const bin = which("quickshell") ?? which("qs");
    if (bin) {
        const qml = join(dirname(dirname(realpathSync(bin))), "lib/qt-6/qml");
        if (existsSync(join(qml, "Quickshell"))) return qml;
    }
    // Last resort on NixOS: newest quickshell in the store (DMS wrappers resolve it at runtime).
    if (existsSync("/nix/store")) {
        const candidates = readdirSync("/nix/store")
            .filter(name => /^[a-z0-9]{32}-quickshell-\d[\d.]*$/.test(name))
            .map(name => join("/nix/store", name, "lib/qt-6/qml"))
            .filter(qml => existsSync(join(qml, "Quickshell")))
            .sort((a, b) => versionOf(b).localeCompare(versionOf(a), undefined, { numeric: true }));
        if (candidates[0]) return candidates[0];
    }
    throw new Error("Quickshell QML modules not found: set QUICKSHELL_QML_DIR or run inside `nix develop`");
}

/** Mirrors one shell directory as module qs.<dotted path>. */
function mirror(source: string, target: string, moduleName: string): void {
    mkdirSync(target, { recursive: true });
    const lines = [`module ${moduleName}`];
    for (const name of readdirSync(source).sort()) {
        const path = join(source, name);
        if (statSync(path).isDirectory()) {
            if (!SKIP.has(name) && !name.startsWith(".")) mirror(path, join(target, name), `${moduleName}.${name}`);
            continue;
        }
        if (!/\.(qml|js|mjs)$/.test(name)) continue;
        symlinkSync(path, join(target, name));
        if (name.endsWith(".qml") && /^[A-Z]/.test(name)) {
            const type = name.slice(0, -4);
            const singleton = /^\s*pragma\s+Singleton\b/m.test(readFileSync(path, "utf8"));
            lines.push(`${singleton ? "singleton " : ""}${type} 1.0 ${name}`);
        }
    }
    writeFileSync(join(target, "qmldir"), `${lines.join("\n")}\n`);
}

export function prepare(): string[] {
    const dms = findDms();
    const quickshell = findQuickshell(dms);
    rmSync(ENV_DIR, { recursive: true, force: true });
    mirror(dms, join(ENV_DIR, "qs"), "qs");
    const importPaths = [ENV_DIR, quickshell];
    writeFileSync(join(ROOT, ".qmlls.ini"), `[General]\nimportPaths="${importPaths.join(":")}"\nno-cmake-calls=true\n`);
    return importPaths;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(prepare().join("\n"));
