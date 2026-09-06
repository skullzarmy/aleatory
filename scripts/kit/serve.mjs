#!/usr/bin/env node
/**
 * A local preview for an Aleatory generator.
 *
 *   node serve.mjs            then open http://localhost:4321
 *   node serve.mjs --port 8080
 *
 * No install, no dependency, no build. Node 18 or newer.
 *
 * It reads the `<meta name="alea:library">` tags in your index.html and loads
 * those libraries for you, the way a renderer loads them from the chain's
 * record once your piece is minted. So your index.html never holds a script tag
 * pointing at a CDN, and cannot be published with one: a piece that fetches
 * while rendering is captured as a blank frame.
 *
 * Edit index.html, reload the browser.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = Number(portArg !== -1 ? args[portArg + 1] : process.env.PORT || 4321);

/**
 * Where a declared library comes from while you work: any package on npm, by
 * name and version, as on the platform. jsDelivr resolves a package's default
 * browser build, so naming a file is only needed when there is no usable one.
 */
function sourceFor(coordinate) {
    return `https://cdn.jsdelivr.net/npm/${coordinate}`;
}

const TAG = /<meta\s+[^>]*name\s*=\s*["']alea:library["'][^>]*>/gi;
const CONTENT = /content\s*=\s*["']([^"']+)["']/i;

function declaredIn(html) {
    const out = [];
    // A tag inside <!-- --> is an example of one, not a declaration.
    for (const tag of html.replace(/<!--[\s\S]*?-->/g, "").match(TAG) ?? []) {
        const value = tag.match(CONTENT)?.[1]?.trim();
        if (value && !out.includes(value)) out.push(value);
    }
    return out;
}

/**
 * Put the declared libraries in front of the piece, before the closing </head>,
 * which is where a renderer puts them.
 */
function withLibraries(html) {
    const declared = declaredIn(html);
    if (declared.length === 0) return { html, declared };

    const tags = declared.map((c) => `  <script src="${sourceFor(c)}"></script>`).join("\n");

    const injected = html.includes("</head>")
        ? html.replace("</head>", `${tags}\n</head>`)
        : `${tags}\n${html}`;

    return { html: injected, declared };
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname !== "/" && url.pathname !== "/index.html") {
        // Anything else the piece asks for, served from beside it. A published
        // generator has to be self-contained; a scratch file while you work
        // does not.
        try {
            const body = await readFile(join(here, url.pathname.slice(1)));
            res.writeHead(200);
            res.end(body);
        } catch {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("Not found\n");
        }
        return;
    }

    let raw;
    try {
        raw = await readFile(join(here, "index.html"), "utf8");
    } catch {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("No index.html beside serve.mjs.\n");
        return;
    }

    const { html, declared } = withLibraries(raw);

    res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        // A cached generator is a reload showing the last edit but one.
        "cache-control": "no-store",
    });
    res.end(html);

    const seed = url.searchParams.get("seed");
    console.log(
        `  drew${seed ? ` seed ${seed.slice(0, 12)}…` : " a new seed"}` +
            (declared.length ? `, with ${declared.join(", ")}` : ""),
    );
});

server.listen(PORT, () => {
    console.log(`\n  Aleatory preview  http://localhost:${PORT}\n`);
    console.log("  reload            a new seed");
    console.log("  ?seed=<hex>       pin one");
    console.log("  ?p.<name>=<value> set a declared parameter\n");
});
