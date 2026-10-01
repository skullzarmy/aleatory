#!/usr/bin/env node
/**
 * Generate index.html from index.src.html.
 *
 *   node build.mjs
 *
 * The only thing this does: substitute `/* ALEA_HARNESS_CORE *\/` with the
 * seeded-PRNG construction shared with `provider/render.mts` and the starter
 * templates (`../src/lib/harness-core.js`), so it is typed once, not retyped
 * into this file by hand.
 *
 * Deliberately dependency-free. This site has no package.json and no other
 * build step, and should not need one just to run this.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const core = readFileSync(join(root, "..", "src/lib/harness-core.js"), "utf8").trim();
const src = readFileSync(join(root, "index.src.html"), "utf8");

const MARKER = "/* ALEA_HARNESS_CORE */";
if (!src.includes(MARKER)) {
    console.error(`No ${MARKER} marker in index.src.html`);
    process.exit(1);
}

const out = src.replace(MARKER, core);
writeFileSync(join(root, "index.html"), out);
console.log("isolate: index.html generated from index.src.html");
