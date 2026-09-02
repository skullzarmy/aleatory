/**
 * Every file path and npm script named in the docs, checked against the repo.
 *
 * Docs rot silently. A renamed script or a moved module leaves prose that
 * still reads fine and sends somebody to a command that does not exist, which
 * is worse than saying nothing, because they assume the fault is theirs.
 *
 * Shorthand is allowed. Docs write `studio/Workspace.tsx` for a file whose
 * full path is `src/components/studio/Workspace.tsx`, and that is clearer in a
 * sentence, so a path counts as real when it is the tail of a tracked file.
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

    // Flags, against the script that would receive them.
    //
    // This is the one that matters. A doc showing `-- --go` for a script that
    // stopped taking --go reads perfectly and sends somebody to a command
    // that quietly does nothing, or worse, does the opposite of what they
    // read. Checking the name existed was never enough.
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

console.log(
    bad === 0 ? "every file and script the docs name exists" : `\n${bad} dead reference(s)`,
);
process.exit(bad === 0 ? 0 : 1);
