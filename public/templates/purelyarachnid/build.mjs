#!/usr/bin/env node
/**
 * Bundle layered PNG assets into one self-contained Aleatory generator.
 *
 *   node build.mjs           write dist/index.html
 *
 * Reads layers/ and inlines each image as a base64 data URI so the output
 * fetches nothing at render time and conforms strictly to ALEATORY-001.
 */

import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function loadEsbuild() {
    try {
        return (await import("esbuild")).build;
    } catch {
        return (await import("esbuild-wasm")).build;
    }
}

const here = dirname(fileURLToPath(import.meta.url));

const FOLDER_RE = /^(\d+)(?:-\(([^)]+)\))?-(.+)$/;
const FILE_RE = /^(\d+)-(.+?)\.(png|webp)$/i;

const ON_CHAIN_CAP = 32_768 - 700;
const CHUNK_CAP = 32_768 - 1_200;

export function parseLayers(layersDir) {
    if (!existsSync(layersDir)) {
        throw new Error(
            `No 'layers' directory found at ${layersDir}. Create a layers folder with subdirectories like '00-background', '01-head'.`,
        );
    }

    const entries = readdirSync(layersDir)
        .filter((name) => statSync(join(layersDir, name)).isDirectory() && !name.startsWith("."))
        .sort();

    if (entries.length === 0) {
        throw new Error(`The 'layers' directory at ${layersDir} has no subdirectories.`);
    }

    const layers = [];

    for (const folder of entries) {
        const match = folder.match(FOLDER_RE);
        if (!match) {
            console.warn(`[purelyarachnid] Skipping directory with unexpected format: ${folder}`);
            continue;
        }

        const [, orderStr, optStr, rawName] = match;
        const order = Number.parseInt(orderStr, 10);
        const name = rawName.replace(/_/g, " ");

        const options = { hide: false, blend: "source-over" };
        if (optStr) {
            for (const part of optStr.split("_")) {
                const [k, ...rest] = part.split("-");
                const val = rest.length ? rest.join("-") : true;
                if (k === "hide") options.hide = val === true || val === "true";
                if (k === "blend") options.blend = val;
            }
        }

        const folderPath = join(layersDir, folder);
        const fileNames = readdirSync(folderPath).filter((f) => !f.startsWith("."));
        const variants = [];

        for (const file of fileNames) {
            const fileMatch = file.match(FILE_RE);
            if (!fileMatch) continue;

            const [, weightStr, rawVariantName, ext] = fileMatch;
            const weight = Number.parseInt(weightStr, 10);
            const variantName = rawVariantName.replace(/_/g, " ");
            const filePath = join(folderPath, file);
            const buffer = readFileSync(filePath);

            let src = null;
            if (buffer.length > 0 && variantName.toLowerCase() !== "none") {
                const mime = ext.toLowerCase() === "webp" ? "image/webp" : "image/png";
                src = `data:${mime};base64,${buffer.toString("base64")}`;
            }

            variants.push({
                id: file,
                name: variantName,
                weight: Math.max(1, weight),
                src,
            });
        }

        if (variants.length === 0) {
            throw new Error(`Layer directory '${folder}' contains no matching .png or .webp files.`);
        }

        layers.push({
            id: folder,
            order,
            name,
            hide: options.hide,
            blend: options.blend,
            variants,
        });
    }

    layers.sort((a, b) => a.order - b.order);
    return layers;
}

export async function buildHtml() {
    const layers = parseLayers(join(here, "layers"));
    const build = await loadEsbuild();

    const layersPlugin = {
        name: "layers-loader",
        setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /^virtual:layers$/ }, (args) => ({
                path: args.path,
                namespace: "layers-ns",
            }));
            pluginBuild.onLoad({ filter: /.*/, namespace: "layers-ns" }, () => ({
                contents: JSON.stringify(layers),
                loader: "json",
            }));
        },
    };

    const result = await build({
        entryPoints: [join(here, "src/sketch.js")],
        bundle: true,
        minify: true,
        format: "iife",
        target: "es2020",
        write: false,
        plugins: [layersPlugin],
        logLevel: "silent",
    });

    const js = result.outputFiles[0].text;
    let shell = readFileSync(join(here, "src/index.html"), "utf8");

    // If running from repo where // alea:harness is not yet expanded, grab canonical harness
    if (/^\s*\/\/ alea:harness\s*$/m.test(shell)) {
        const vanillaPath = join(here, "../vanilla/index.html");
        if (existsSync(vanillaPath)) {
            const vanilla = readFileSync(vanillaPath, "utf8");
            const match = vanilla.match(/\/\/ alea:harness:start\n([\s\S]*?)\n\s*\/\/ alea:harness:end/);
            if (match) {
                shell = shell.replace(/^\s*\/\/ alea:harness\s*$/m, () => match[1]);
            }
        }
    }

    const html = shell.replace(/^\s*\/\/ alea:bundle\s*$/m, () => js);
    if (html === shell) throw new Error("src/index.html has no `// alea:bundle` line");
    return html;
}

function report(html) {
    const raw = Buffer.byteLength(html);
    const gz = gzipSync(Buffer.from(html)).length;

    console.log(`  ${raw.toLocaleString()} bytes, ${gz.toLocaleString()} gzipped`);

    if (raw <= ON_CHAIN_CAP) {
        const pct = Math.round((raw / ON_CHAIN_CAP) * 100);
        console.log(`  on chain in one signature, ${pct}% of the ${ON_CHAIN_CAP.toLocaleString()} byte operation cap`);
        return;
    }

    const chunks = Math.ceil(gz / CHUNK_CAP);
    console.log(
        `  on chain, walked in ${chunks} chunk${chunks === 1 ? "" : "s"}: ${chunks + 2} signatures to publish`,
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
