#!/usr/bin/env node
/**
 * Generate index.html and _headers from index.src.html.
 *
 *   node build.mjs
 *
 * index.html: substitute `/* ALEA_HARNESS_CORE *\/` with the seeded-PRNG
 * construction shared with `provider/render.mts` and the starter templates
 * (`../src/lib/harness-core.js`), so it is typed once, not retyped into this
 * file by hand.
 *
 * _headers: the CSP's frame-ancestors list, which names every host allowed
 * to frame this isolate. Netlify injects CONTEXT and REVIEW_ID into this
 * build command already; on a deploy preview this appends the matching PR
 * preview of the main site, so opening a preview of a PR has a working
 * isolate to frame instead of one that refuses it. Outside deploy-preview
 * context the output is byte-identical to the static list below.
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

// Splices raw into a template literal in index.src.html. A backtick closes it
// early; `${` opens interpolation that String.raw does not suppress — both
// parse fine and fail only when the browser runs that line.
if (core.includes("`") || core.includes("${")) {
    console.error("harness-core.js contains a backtick or ${, which breaks the splice into index.src.html");
    process.exit(1);
}

const out = src.replace(MARKER, core);
writeFileSync(join(root, "index.html"), out);
console.log("isolate: index.html generated from index.src.html");

const FRAME_ANCESTORS = [
    "https://aleatory.art",
    "https://*.aleatory.art",
    "http://localhost:*",
    "https://alea-mainnet.netlify.app",
];
if (process.env.CONTEXT === "deploy-preview" && process.env.REVIEW_ID) {
    FRAME_ANCESTORS.push(
        `https://deploy-preview-${process.env.REVIEW_ID}--aleatoryart.netlify.app`,
    );
}

const csp = [
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
    `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`,
].join("; ");

const headers = [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()",
    "",
].join("\n");

writeFileSync(join(root, "_headers"), headers);
console.log("isolate: _headers generated");
