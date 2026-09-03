#!/usr/bin/env node
/**
 * A local preview for a bundled Aleatory generator.
 *
 *   node serve.mjs            then open http://localhost:4321
 *   node serve.mjs --port 8080
 *
 * Rebuilds on every request, so the loop is: edit, reload. There is no watcher
 * and nothing to keep in sync.
 *
 * It also reads the `<meta name="alea:library">` tags in src/index.html and
 * loads those from a CDN, the same way the other kits do, so declaring and
 * bundling work together. Your file never contains a script tag pointing at a
 * CDN: a piece is refused the network while it renders, and one that tries is
 * captured as a blank frame.
 */

import { createServer } from "node:http";
import { buildHtml } from "./build.mjs";

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = Number(portArg !== -1 ? args[portArg + 1] : process.env.PORT || 4321);

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

/** Put the declared libraries in front of the piece, as a renderer will. */
function withLibraries(html) {
    const tags = declaredIn(html)
        .map((c) => `<script src="https://cdn.jsdelivr.net/npm/${c}"></script>`)
        .join("\n");
    if (!tags) return html;
    return html.replace(/<\/head>/i, `${tags}\n</head>`);
}

createServer(async (req, res) => {
    if (req.url === "/favicon.ico") {
        res.writeHead(204).end();
        return;
    }
    try {
        const html = withLibraries(await buildHtml());
        res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
        });
        res.end(html);
    } catch (err) {
        // The build failed, so say why on the page rather than in a terminal
        // the browser is covering.
        const message = String(err?.message ?? err);
        console.error(`\n  ${message}\n`);
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end(
            `<pre style="font:14px ui-monospace,monospace;color:#c8553d;padding:2rem;white-space:pre-wrap">${message.replace(
                /[<&]/g,
                (c) => (c === "<" ? "&lt;" : "&amp;"),
            )}</pre>`,
        );
    }
}).listen(PORT, () => {
    console.log(`\n  http://localhost:${PORT}\n  reload for a new seed, ?seed=<hex> to pin one\n`);
});
