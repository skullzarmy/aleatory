/**
 * Every file path and npm script named in the docs, checked against the repo. A
 * renamed script or a moved module leaves prose that still reads fine and sends
 * somebody to a command that does not exist.
 *
 * Shorthand counts: docs write `studio/Workspace.tsx` for
 * `src/components/studio/Workspace.tsx`, so a path is real when it is the tail
 * of a tracked file.
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const tracked = execSync("git ls-files", { encoding: "utf8" }).trim().split("\n");
const scripts = new Map(Object.entries(JSON.parse(readFileSync("package.json", "utf8")).scripts));

const docs = execSync("git ls-files '*.md'", { encoding: "utf8" }).trim().split("\n");

const isReal = (p) => existsSync(p) || tracked.some((t) => t === p || t.endsWith(`/${p}`));

let bad = 0;

for (const doc of docs) {
    const src = readFileSync(doc, "utf8");

    for (const m of src.matchAll(
        /`([a-zA-Z0-9_./[\]-]+\.(?:ts|tsx|mts|mjs|js|py|json|html|yml))`/g,
    )) {
        const path = m[1];
        // A path inside a published npm package is not a path in this repo.
        if (!path.includes("/") || path.startsWith(".")) continue;
        if (/^(lib|dist|build|package)\//.test(path)) continue;
        // Placeholders in prose. `/path/to/file.js` describes a shape rather
        // than naming anything.
        if (/^\/?path\/to\//.test(path)) continue;
        if (!isReal(path)) {
            bad++;
            console.log(`MISSING FILE    ${doc}: ${path}`);
        }
    }

    for (const m of src.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
        if (!scripts.has(m[1])) {
            bad++;
            console.log(`MISSING SCRIPT  ${doc}: npm run ${m[1]}`);
        }
    }

    // Flags, against the script that would receive them. A doc showing `--
    // --go` for a script that stopped taking it reads perfectly and does
    // nothing, or the opposite of what it says.
    for (const m of src.matchAll(/npm run ([a-z0-9:_-]+) -- (--[a-z-]+)/g)) {
        const [, name, flag] = m;
        const command = scripts.get(name);
        if (!command) continue;

        const file = command.match(/([a-zA-Z0-9_./-]+\.(?:mts|ts|mjs|js))/)?.[1];
        if (!file || !existsSync(file)) continue;

        if (!readFileSync(file, "utf8").includes(flag)) {
            bad++;
            console.log(
                `UNKNOWN FLAG    ${doc}: npm run ${name} -- ${flag}  (${file} never reads it)`,
            );
        }
    }
}

/**
 * Documents named by the source, against what a checkout contains. Some
 * documents here are working notes and gitignored: the decision log, the
 * roadmap, the audit and its response. A comment citing one points everybody
 * but its author at a file they do not have.
 */
const source = execSync("git ls-files '*.ts' '*.tsx' '*.mts' '*.mjs' '*.js' '*.py' '*.html'", {
    encoding: "utf8",
})
    .trim()
    .split("\n")
    .filter(Boolean);

/**
 * Tracked, not merely present. `isReal` above accepts a file on disk, and the
 * documents this catches are gitignored, so they sit in one working copy and no
 * checkout.
 */
const isTracked = (p) => tracked.some((t) => t === p || t.endsWith(`/${p}`));

for (const file of source) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
        // Whole-line and trailing comments both. Whitespace before the slashes,
        // or `https://` reads as the start of one.
        const comment = /^\s*(?:\*|\/\/|#)/.test(line)
            ? line
            : (line.match(/(?:^|\s)\/\/(.*)$/) ?? [])[1];
        if (!comment) continue;

        for (const m of comment.matchAll(/([a-zA-Z0-9_./-]*[a-zA-Z0-9_-]\.md)\b/g)) {
            const named = m[1];
            if (/^(https?|www)/.test(named)) continue;
            if (isTracked(named)) continue;
            bad++;
            console.log(`UNTRACKED DOC   ${file}: ${named}  (not in a checkout)`);
        }
    }
}

console.log(
    bad === 0 ? "every file and script the docs name exists" : `\n${bad} dead reference(s)`,
);
process.exit(bad === 0 ? 0 : 1);
