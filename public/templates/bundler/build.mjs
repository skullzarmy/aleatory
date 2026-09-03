#!/usr/bin/env node
/**
 * Bundle src/sketch.js into one self-contained HTML file.
 *
 *   node build.mjs           write dist/index.html
 *
 * Publishing takes a single document that fetches nothing while it renders, so
 * everything imported has to end up inside it. esbuild drops the parts of a
 * package you did not use, which is what keeps this affordable: `d3-scale` and
 * `d3-shape` together come to about 10 kB, against 279 kB for the whole d3.
 */

import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * What one operation can carry, gzipped, once the rest of a deploy is paid for.
 *
 * The same figure `src/lib/publish.ts` uses. A generator over it is still
 * publishable: it goes to IPFS and the contract stores a pointer, which is a
 * different promise from being on chain, so the build says which one you are
 * about to make.
 */
const ON_CHAIN_CAP = 32_768 - 700;

export async function buildHtml() {
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

    // A function replacement, so a `$&` or `$1` in somebody's bundle is not
    // read as a backreference and silently eaten.
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
