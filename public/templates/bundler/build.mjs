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
 * Gzipped byte cap for one on-chain operation. Matches the figure used in
 * `src/lib/publish.ts`. A generator over the cap still publishes; it just
 * goes to IPFS with a pointer stored on chain instead.
 */
const ON_CHAIN_CAP = 32_768 - 700;

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
    const pct = Math.round((gz / ON_CHAIN_CAP) * 100);

    console.log(`  ${raw.toLocaleString()} bytes, ${gz.toLocaleString()} gzipped`);
    console.log(
        gz <= ON_CHAIN_CAP
            ? `  fits on chain, ${pct}% of the ${ON_CHAIN_CAP.toLocaleString()} byte cap`
            : `  ${(gz / ON_CHAIN_CAP).toFixed(1)}x over the ${ON_CHAIN_CAP.toLocaleString()} byte cap.\n` +
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
