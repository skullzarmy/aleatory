/**
 * Claims the documentation makes about the contracts, against the contracts.
 *
 * The contract table said five when there were seven, and a sentence two
 * paragraphs above it said six. Prose about code drifts silently and reads
 * fine while it does, so the counts and the names are checked rather than
 * proofread.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const source = ["contract/aleatory.py", "contract/marketplace.py"]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

const classes = [...source.matchAll(/class Aleatory(\w+)\s*\(/g)].map((m) => m[1]);
const entrypoints = new Set(
    [...source.matchAll(/def\s+([a-z_]+)\s*\(self/g)].map((m) => m[1]),
);

const WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten"];
const docs = execSync("git ls-files '*.md'", { encoding: "utf8" }).trim().split("\n");

let bad = 0;

for (const doc of docs) {
    const text = readFileSync(doc, "utf8");

    // "Seven contracts" / "7 contracts"
    for (const m of text.matchAll(/\b([A-Za-z]+|\d+)\s+contracts\b/g)) {
        const raw = m[1].toLowerCase();
        const n = /^\d+$/.test(raw) ? Number(raw) : WORDS.indexOf(raw);
        if (n < 0) continue;
        if (n !== classes.length) {
            bad++;
            console.log(`COUNT   ${doc}: says ${m[0]}, there are ${classes.length}`);
        }
    }

    // Entrypoints named in backticks that no contract defines.
    for (const m of text.matchAll(/`([a-z][a-z0-9_]{3,30})\(\)?`/g)) {
        const name = m[1];
        if (!/_/.test(name)) continue;           // single words are usually prose
        if (entrypoints.has(name)) continue;
        if (/^(npm|node|npx)/.test(name)) continue;
        bad++;
        console.log(`ENTRYPOINT ${doc}: \`${name}\` is not defined in any contract`);
    }
}

console.log(
    bad === 0
        ? `the docs agree with the contracts (${classes.length}: ${classes.join(", ")})`
        : `\n${bad} disagreement(s)`,
);
process.exit(bad === 0 ? 0 : 1);
