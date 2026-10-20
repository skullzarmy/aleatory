#!/usr/bin/env node
/**
 * A local preview for the PurelyArachnid layered PNG generator.
 *
 *   node serve.mjs            then open http://localhost:4321
 *   node serve.mjs --port 8080
 *
 * Rebuilds on every request from layers/, so the loop is edit images, reload.
 */

import { createServer } from "node:http";
import { buildHtml } from "./build.mjs";

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = Number(portArg !== -1 ? args[portArg + 1] : process.env.PORT || 4321);

createServer(async (req, res) => {
    if (req.url === "/favicon.ico") {
        res.writeHead(204).end();
        return;
    }
    try {
        const html = await buildHtml();
        res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
        });
        res.end(html);
    } catch (err) {
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
