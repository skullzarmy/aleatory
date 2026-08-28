#!/usr/bin/env node
/**
 * A local preview for an Aleatory generator.
 *
 *   node serve.mjs            then open http://localhost:4321
 *   node serve.mjs --port 8080
 *
 * No install, no dependency, no build. Node 18 or newer.
 *
 * What it does that opening the file directly does not: it reads the
 * `<meta name="alea:library">` tags in your index.html and loads those
 * libraries for you from a CDN, the same way a renderer will load them from
 * the chain's record when your piece is minted.
 *
 * That is the point. Your index.html never contains a script tag pointing at a
 * CDN, so it cannot be published with one by accident. A piece that fetches
 * anything while rendering is not conforming: the sandbox blocks the request
 * and the capture is of a blank frame, which is discovered after minting, when
 * the piece can no longer be changed.
 *
 * Edit index.html, reload the browser. That is the whole loop.
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
 * Where a declared library is fetched from for local work.
 *
 * Generated from the same catalogue the platform uses, so the version you
 * develop against is the version that renders. A library not listed here falls
 * back to jsDelivr's own guess at the package's browser build, which usually
 * works and is not guaranteed to.
 */
const LIBRARIES = __LIBRARIES__;

function sourceFor(coordinate) {
    const known = LIBRARIES[coordinate];
    if (known) return `https://cdn.jsdelivr.net/npm/${coordinate}/${known}`;
    return `https://cdn.jsdelivr.net/npm/${coordinate}`;
}

const TAG = /<meta\s+[^>]*name\s*=\s*["']alea:library["'][^>]*>/gi;
const CONTENT = /content\s*=\s*["']([^"']+)["']/i;

function declaredIn(html) {
    const out = [];
    for (const tag of html.match(TAG) ?? []) {
        const value = tag.match(CONTENT)?.[1]?.trim();
        if (value && !out.includes(value)) out.push(value);
    }
    return out;
}

/**
 * Put the declared libraries in front of the piece.
 *
 * Injected right before the closing </head>, so they are defined before any of
 * the artist's code runs, which is where a renderer puts them too.
 */
function withLibraries(html) {
    const declared = declaredIn(html);
    if (declared.length === 0) return { html, declared };

    const tags = declared
        .map((c) => `  <script src="${sourceFor(c)}"></script>`)
        .join("\n");

    const injected = html.includes("</head>")
        ? html.replace("</head>", `${tags}\n</head>`)
        : `${tags}\n${html}`;

    return { html: injected, declared };
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname !== "/" && url.pathname !== "/index.html") {
        // Anything else the piece asks for, served from beside it. A generator
        // must end up self-contained, but while you are working it is
        // reasonable to keep a scratch file next to it.
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
        // Always the file as it is on disk. A cached generator is a reload
        // that shows you the last edit but one.
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
