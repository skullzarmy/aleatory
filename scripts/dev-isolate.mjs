/**
 * The provider's render host, locally.
 *
 * Generator code runs on a different host from the app in production, and the
 * headers that host sends are the security control rather than a formality. A
 * host served without them would let a piece do things locally that
 * production forbids, which is the wrong direction for a difference to run in:
 * you find out on deploy. So this serves the same document under the same
 * Content-Security-Policy as `isolate/netlify.toml`.
 *
 *   node scripts/dev-isolate.mjs [port]
 *
 * Then point the app at it:
 *
 *   NEXT_PUBLIC_ISOLATE_ORIGIN=http://localhost:4321
 *
 * The studio does not need this. Its preview frames come from `srcdoc` with
 * `sandbox="allow-scripts"`, which puts a piece in an opaque origin already.
 * This is for `/piece/*` and `/collection/*`, which frame the deployed host.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DOC = join(here, "..", "isolate", "index.html");
const PORT = Number(process.argv[2] || process.env.ISOLATE_PORT || 4321);

/**
 * Kept in step with isolate/netlify.toml by hand, with one deliberate
 * difference: frame-ancestors accepts localhost on any port, because the dev
 * server's port is not fixed.
 */
const CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'self'",
    "child-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors http://localhost:* http://127.0.0.1:*",
].join("; ");

createServer(async (req, res) => {
    try {
        // One document, whatever the path. It reads the query string.
        const html = await readFile(DOC, "utf8");
        res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": CSP,
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "cache-control": "no-store",
        });
        res.end(html);
    } catch (e) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(e));
    }
}).listen(PORT, () => {
    console.log(`provider  http://localhost:${PORT}`);
    console.log(`         serving isolate/index.html on every path, with the production CSP`);
    console.log(
        `         set NEXT_PUBLIC_ISOLATE_ORIGIN=http://localhost:${PORT} and restart next dev`,
    );
});
