#!/usr/bin/env node
/**
 * Bundle src/sketch.js into one self-contained HTML file.
 *
 *   node build.mjs           write dist/index.html
 *
 * The output fetches nothing at render time, so anything imported must be
 * bundled in. esbuild only keeps the parts of a package you actually use, so
 * importing `d3-scale` and `d3-shape` costs about 10 kB instead of the 279 kB
 * for all of d3.
 */

import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * esbuild ships a native binary; browser-based Node runtimes disable native
 * addons, so this falls back to `esbuild-wasm` (slower, but works anywhere).
 */
async function loadEsbuild() {
    try {
        return (await import("esbuild")).build;
    } catch {
        return (await import("esbuild-wasm")).build;
    }
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The three routes on chain, and the sizes between them. Matches
 * `src/lib/plan.ts`, which is what the studio quotes and the publisher does.
 *
 * Past one operation a generator is not off chain: it is compressed and walked
 * into storage a chunk at a time, one signature per chunk. Only past the walk
 * budget does it go to IPFS with a pointer stored on chain instead.
 */
const ON_CHAIN_CAP = 32_768 - 700;
const CHUNK_CAP = 32_768 - 1_200;
const MAX_WALK_CHUNKS = 8;

export async function buildHtml() {
    const build = await loadEsbuild();
    const result = await build({
        entryPoints: [join(here, "src/sketch.js")],
        bundle: true,
        minify: true,
        format: "iife",
        target: "es2020",
        write: false,
        logLevel: "silent",
    });

    const js = result.outputFiles[0].text;
    const shell = readFileSync(join(here, "src/index.html"), "utf8");

    // Function replacement, so a `$&` or `$1` in the bundle isn't read as a
    // backreference and silently eaten.
    const html = shell.replace(/^\s*\/\/ alea:bundle\s*$/m, () => js);
    if (html === shell) throw new Error("src/index.html has no `// alea:bundle` line");
    return html;
}

function report(html) {
    const raw = Buffer.byteLength(html);
    const gz = gzipSync(Buffer.from(html)).length;

    console.log(`  ${raw.toLocaleString()} bytes, ${gz.toLocaleString()} gzipped`);

    // The publisher compresses only when the raw source will not fit inline, so
    // a small build is quoted on its raw size the way it is actually stored.
    if (raw <= ON_CHAIN_CAP) {
        const pct = Math.round((raw / ON_CHAIN_CAP) * 100);
        console.log(`  on chain in one signature, ${pct}% of the ${ON_CHAIN_CAP.toLocaleString()} byte operation cap`);
        return;
    }

    const chunks = Math.ceil(gz / CHUNK_CAP);
    console.log(
        chunks <= MAX_WALK_CHUNKS
            ? `  on chain, walked in ${chunks} chunk${chunks === 1 ? "" : "s"}: ${chunks + 2} signatures to publish`
            : `  past the ${(CHUNK_CAP * MAX_WALK_CHUNKS).toLocaleString()} bytes ${MAX_WALK_CHUNKS} chunks carry.\n` +
                  "  Publishable, but stored on IPFS with a pointer on chain rather than on chain.",
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const html = await buildHtml();
    mkdirSync(join(here, "dist"), { recursive: true });
    writeFileSync(join(here, "dist/index.html"), html);
    console.log("\n  dist/index.html");
    report(html);
    console.log("");
}
