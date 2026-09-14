/**
 * Every environment variable the code reads, checked against the examples.
 *
 * Config drifts the way prose does, and worse: an undocumented variable is one
 * an operator only learns about from a stack trace, and a documented one that
 * nothing reads is an instruction to do something that has no effect. The bot
 * shipped with seven variables and no mention of any of them.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const tracked = execSync("git ls-files", { encoding: "utf8" }).trim().split("\n");
const code = tracked.filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f));

/** `process.env.X`, and the helpers that take the name as a string. */
const READS = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g,
    /requireEnv\(\s*["']([A-Z][A-Z0-9_]+)["']/g,
];

/** Set by the runtime or the host, never by an operator editing a file. */
const PLATFORM = new Set(["NODE_ENV", "PORT", "URL", "DEPLOY_URL"]);

const used = new Map();
for (const file of code) {
    const source = readFileSync(file, "utf8");
    for (const pattern of READS) {
        for (const m of source.matchAll(pattern)) {
            if (!used.has(m[1])) used.set(m[1], file);
        }
    }
}

const examples = ["\.env.example", "admin/.env.example"]
    .map((f) => {
        try {
            return readFileSync(f, "utf8");
        } catch {
            return "";
        }
    })
    .join("\n");

// A name assigned in an example counts as documented whether or not the line is
// commented out: commented is how an optional one is shown. A name that appears
// only in prose counts too, which is how a legacy spelling is recorded.
const assigned = new Set([...examples.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const mentioned = (name) => assigned.has(name) || examples.includes(name);

let bad = 0;

for (const [name, file] of [...used].sort()) {
    if (PLATFORM.has(name) || mentioned(name)) continue;
    bad++;
    console.log(`UNDOCUMENTED  ${name}  read in ${file}`);
}

for (const name of [...assigned].sort()) {
    if (used.has(name)) continue;
    bad++;
    console.log(`UNREAD        ${name}  named in an example, read nowhere`);
}

console.log(
    bad === 0
        ? `\nevery variable the code reads is documented (${used.size} read, ${assigned.size} named)`
        : `\n${bad} problem(s)`,
);
process.exit(bad === 0 ? 0 : 1);
