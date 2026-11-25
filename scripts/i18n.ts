// Translation tooling for the plugin's UI strings.
//
//   node scripts/i18n.ts check   fail if a translations/*.json misses, keeps obsolete or has empty strings
//   node scripts/i18n.ts sync    add missing keys (empty) and drop obsolete ones in every locale file
//   node scripts/i18n.ts list    print the extracted source strings
//
// Source strings are the English literals passed to I18n.trFor("timeTracker", "...") in QML,
// plus provider setting labels/descriptions (rendered through trFor at runtime).
// File format follows DMS: { "<term>": { "<term>": "<translation>" } }.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { providers } from "../src/providers/registry.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const PLUGIN_ID = "timeTracker";
const TRANSLATIONS = join(ROOT, "translations");
const SKIP_DIRS = new Set(["node_modules", "tests", ".git", "result", "docs"]);

type Catalog = Record<string, Record<string, string>>;

function qmlFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (!SKIP_DIRS.has(name)) out.push(...qmlFiles(path));
        } else if (name.endsWith(".qml")) {
            out.push(path);
        }
    }
    return out;
}

const CALL = /I18n\.trFor\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*"|[^,)]+)/g;

export interface Extraction {
    strings: Set<string>;
    problems: string[];
}

export function extract(): Extraction {
    const strings = new Set<string>();
    const problems: string[] = [];
    for (const file of qmlFiles(ROOT)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(CALL)) {
            const line = source.slice(0, match.index).split("\n").length;
            const where = `${relative(ROOT, file)}:${line}`;
            const id = JSON.parse(match[1] as string) as string;
            if (id !== PLUGIN_ID) problems.push(`${where}: plugin id must be the literal "${PLUGIN_ID}", got "${id}"`);
            const term = (match[2] as string).trim();
            if (term.startsWith('"')) strings.add(JSON.parse(term) as string);
            else if (!/^\w+\.modelData\.(label|description)$/.test(term))
                problems.push(`${where}: dynamic term "${term}" can't be extracted; use a string literal`);
        }
    }
    // Provider setting texts are passed to trFor dynamically by the settings screen.
    for (const provider of providers) {
        for (const field of provider.settings) {
            strings.add(field.label);
            if (field.description) strings.add(field.description);
        }
    }
    return { strings, problems };
}

function locales(): string[] {
    return readdirSync(TRANSLATIONS)
        .filter(name => name.endsWith(".json"))
        .sort();
}

function readCatalog(file: string): Catalog {
    return JSON.parse(readFileSync(join(TRANSLATIONS, file), "utf8")) as Catalog;
}

function translation(catalog: Catalog, term: string): string | undefined {
    return catalog[term]?.[term];
}

function check(): number {
    const { strings, problems } = extract();
    for (const file of locales()) {
        const catalog = readCatalog(file);
        for (const term of strings) {
            const value = translation(catalog, term);
            if (value === undefined) problems.push(`translations/${file}: missing "${term}"`);
            else if (value.trim() === "") problems.push(`translations/${file}: empty translation for "${term}"`);
            else if ((term.match(/%\d/g) ?? []).sort().join() !== (value.match(/%\d/g) ?? []).sort().join())
                problems.push(`translations/${file}: placeholders differ for "${term}"`);
        }
        for (const term of Object.keys(catalog)) {
            if (!strings.has(term)) problems.push(`translations/${file}: obsolete "${term}" (run: npm run i18n:sync)`);
        }
    }
    if (problems.length) {
        console.error(problems.join("\n"));
        console.error(`\n${problems.length} i18n problem(s).`);
        return 1;
    }
    console.log(`i18n OK: ${strings.size} strings, locales: ${locales().join(", ")}`);
    return 0;
}

function sync(): number {
    const { strings } = extract();
    const sorted = [...strings].sort((a, b) => a.localeCompare(b));
    for (const file of locales()) {
        const catalog = readCatalog(file);
        const next: Catalog = {};
        for (const term of sorted) next[term] = { [term]: translation(catalog, term) ?? "" };
        writeFileSync(join(TRANSLATIONS, file), `${JSON.stringify(next, null, 4)}\n`);
        console.log(`translations/${file}: ${sorted.filter(t => !translation(catalog, t)).length} new/empty`);
    }
    return 0;
}

const command = process.argv[2] ?? "check";
if (command === "check") process.exit(check());
else if (command === "sync") process.exit(sync());
else if (command === "list") console.log([...extract().strings].sort().join("\n"));
else {
    console.error("usage: node scripts/i18n.ts check|sync|list");
    process.exit(2);
}
