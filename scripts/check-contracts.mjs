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
const entrypoints = new Set([...source.matchAll(/def\s+([a-z_]+)\s*\(self/g)].map((m) => m[1]));

const WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
];
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
        if (!/_/.test(name)) continue; // single words are usually prose
        if (entrypoints.has(name)) continue;
        if (/^(npm|node|npx)/.test(name)) continue;
        bad++;
        console.log(`ENTRYPOINT ${doc}: \`${name}\` is not defined in any contract`);
    }
}

// Runtime kinds, from the catalog that defines them.
{
    const runtimes = readFileSync("src/lib/runtimes.ts", "utf8");
    const kinds = [...runtimes.matchAll(/kindId:\s*(\d+),\s*\n\s*name:\s*"([a-z]+)"/g)].map(
        (m) => ({ id: m[1], name: m[2] }),
    );

    const arch = readFileSync("docs/architecture.md", "utf8");
    for (const k of kinds) {
        if (!new RegExp(`\\|\\s*${k.id}\\s*\\|\\s*\`${k.name}\``).test(arch)) {
            bad++;
            console.log(`KIND    docs/architecture.md: no row for kind ${k.id} \`${k.name}\``);
        }
    }

    // And nothing invented. Kind names appear in that table and nowhere else
    // as a claim about what exists.
    for (const m of arch.matchAll(/\|\s*\d+\s*\|\s*`([a-z]+)`/g)) {
        if (!kinds.some((k) => k.name === m[1])) {
            bad++;
            console.log(`KIND    docs/architecture.md: \`${m[1]}\` is not a runtime kind`);
        }
    }
}

// Storage the deploy script builds, against the storage the contract declares.
//
// Taquito encodes an origination by walking the contract's own storage schema
// and taking the keys it finds, so a field the contract dropped stays in
// deploy.ts and is silently discarded. `royalties_owed` sat there through a
// deploy that worked, naming a field that no longer existed, which is the one
// place a rename can hide with nothing failing.
{
    const deploy = readFileSync("contract/deploy.ts", "utf8");
    for (const [name, cls] of [
        ["marketplace", "AleatoryMarketplace"],
        ["registry", "AleatoryRegistry"],
        ["router", "AleatoryRouter"],
        ["factory", "AleatoryFactory"],
        ["resolver", "AleatoryResolver"],
        ["provider", "AleatoryProvider"],
    ]) {
        const at = deploy.indexOf(`case '${name}':`);
        if (at === -1) continue;

        // The storage object this arm returns, and only that: bounded by its
        // own `return {` and the brace that closes it, so neither a nested
        // value nor the next arm nor an unrelated call further down is read
        // as one of this contract's fields.
        const arm = deploy.slice(at + 1);
        const nextCase = arm.search(/^\s*case '/m);
        const lines = (nextCase === -1 ? arm : arm.slice(0, nextCase)).split("\n");
        // A one-line `return { ... }` arm has no fields worth checking this
        // way, and looking past it would read the following arm's.
        const opens = lines.findIndex((l) => /^\s*return \{\s*$/.test(l));
        if (opens === -1) continue;
        const indent = lines[opens].match(/^\s*/)[0];
        const closes = lines.findIndex((l, i) => i > opens && l === `${indent}}`);
        if (closes === -1) continue;

        const built = lines
            .slice(opens + 1, closes)
            .filter((l) => l.startsWith(`${indent}  `) && !l.startsWith(`${indent}   `))
            .map((l) => /^\s*([a-z_][a-z0-9_]*):/.exec(l)?.[1])
            .filter(Boolean);
        if (built.length === 0) continue;

        // The contract's own storage fields, from its sp.Contract __init__.
        const body = source.slice(source.indexOf(`class ${cls}(`));
        const init = body.slice(0, body.indexOf("\n    @sp."));
        const declared = new Set(
            [...init.matchAll(/self\.data\.([a-z_][a-z0-9_]*)\s*=/g)].map((m) => m[1]),
        );
        if (declared.size === 0) continue;

        for (const field of built) {
            if (declared.has(field)) continue;
            bad++;
            console.log(
                `STORAGE contract/deploy.ts: ${name} builds \`${field}\`, which ${cls} does not declare`,
            );
        }
    }
}

console.log(
    bad === 0
        ? `the docs agree with the contracts (${classes.length}: ${classes.join(", ")})`
        : `\n${bad} disagreement(s)`,
);
process.exit(bad === 0 ? 0 : 1);
