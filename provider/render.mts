/**
 * Rendering a piece, through Cloudflare Browser Run. In: the generator's
 * source, a seed, parameters. Out: PNG bytes and whatever traits the piece
 * reported. The REST endpoint takes raw HTML, so there is no Worker to deploy
 * and no `workers.dev` URL to guard.
 *
 * The provider's half of the two harness implementations. The other is
 * `isolate/index.html`, which draws for a viewer. The seeded-PRNG core both
 * start from is one shared file (`src/lib/harness-core.js`) now, not two
 * copies kept in step by hand — everything around it (capture mechanism,
 * param/feature wiring) still has to agree by conforming to ALEATORY-001 §7,
 * because a piece has to look the same in a browser as in the image that ends
 * up on chain, and the two run in genuinely different contexts.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The seeded-PRNG construction (xmur3 + sfc32), shared verbatim with
 * `isolate/index.html` and the starter templates via `src/lib/harness-core.js`.
 * Read once at module load, not retyped here — a second copy is a second
 * thing to drift, which is how the templates ended up warming the stream 16
 * extra times before this got consolidated.
 */
const HARNESS_CORE = readFileSync(join(__dirname, "..", "src/lib/harness-core.js"), "utf8");

const API = "https://api.cloudflare.com/client/v4/accounts";

/** Long edge of a rendered piece. */
const SIZE = 1000;

/**
 * How long to wait for a piece to signal. A generator sets its own capture
 * point and cannot be trusted to reach it, so this is the ceiling — the
 * in-page fallback (below) fires at this minus 2s, which is what keeps it
 * ahead of Cloudflare's own `waitForSelector` wait at this exact value.
 * Matches isolate/index.html's default so a piece behaves the same whether a
 * viewer or the renderer is the one waiting on it.
 */
const CAPTURE_TIMEOUT_MS = 22_000;

export interface RenderInput {
    /** The generator, decoded. Already has its libraries inlined if it needs any. */
    code: string;
    /** The mint operation hash. */
    seed: string;
    /** Resolved parameter values, as the token records them. */
    params?: Record<string, unknown>;
    /** Library sources, inlined ahead of the artist's code. */
    deps?: string[];
}

export interface RenderConfig {
    accountId: string;
    apiToken: string;
}

export function renderConfigFromEnv(): RenderConfig | null {
    // Both spellings: CLOUDFLARE_* is what Cloudflare's own tooling reads.
    const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
    const apiToken = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
    if (!accountId || !apiToken) return null;
    return { accountId, apiToken };
}

/**
 * The determinism harness, kept in step with `isolate/index.html` by hand, with
 * one addition: it marks the document when the piece signals, so the renderer
 * has a selector to wait on. A screenshot before that point is a half-drawn
 * piece, published permanently.
 */
function harness(seed: string, params: Record<string, unknown>): string {
    const config = JSON.stringify({ seed, params }).replace(/<\/script/gi, "<\\/script");
    return `
(function () {
  "use strict";
  var CFG = ${config};

  ${HARNESS_CORE}

  // The seed is a base58 operation hash and is never hex. Parsing it as hex
  // yields zero for every word and every piece draws the same picture.
  var s = xmur3(String(CFG.seed || "unseeded"));
  var rand = sfc32(s(), s(), s(), s());
  Math.random = rand;

  var FIXED = 0;
  var RealDate = Date;
  Date = class extends RealDate {
    constructor() { if (arguments.length === 0) super(FIXED); else super(...arguments); }
    static now() { return FIXED; }
  };
  performance.now = function () { return 0; };

  var done = false;
  function finish() {
    if (done) return;
    done = true;
    // An attribute, because a selector is the only thing the screenshot
    // endpoint can watch for.
    document.documentElement.setAttribute("data-alea-ready", "1");
    // Same idea, for traits: the snapshot endpoint hands back the page's
    // HTML alongside the image, so this is how they leave the page. A piece
    // that reports nothing here ends with features: {}, not a failed render.
    document.documentElement.setAttribute("data-alea-features", JSON.stringify(featureStore));
  }

  var featureStore = {};
  window.$alea = {
    version: 2,
    seed: CFG.seed,
    hash: CFG.seed,
    params: CFG.params,
    random: rand,
    rand: rand,
    randInt: function (lo, hi) { return Math.floor(rand() * (hi - lo + 1)) + lo; },
    randBetween: function (lo, hi) { return lo + rand() * (hi - lo); },
    pick: function (arr) { return arr[Math.floor(rand() * arr.length)]; },
    chance: function (p) { return rand() < p; },
    param: function (n, d) { return n in CFG.params ? CFG.params[n] : d; },
    features: function (o) {
      if (!o) return featureStore;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) featureStore[k] = o[k];
      return featureStore;
    },
    ready: finish
  };

  // A piece that never signals is captured on the ceiling rather than never.
  setTimeout(finish, ${CAPTURE_TIMEOUT_MS - 2000});
})();
`;
}

/**
 * Assemble the document. Injected as early as the document allows, so the CSP
 * covers everything and the harness beats the artist's first line.
 */
export function buildDocument(input: RenderInput): string {
    const csp = [
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval'",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "media-src data: blob:",
        "font-src data:",
        // The control: a piece that fetches is not reproducible.
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ");

    const libs = (input.deps ?? [])
        .map((src) => `<script>${src.replace(/<\/script/gi, "<\\/script")}<\/script>`)
        .join("\n");

    const injected =
        `<meta charset="utf-8">\n` +
        `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` +
        `<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}` +
        `canvas{display:block}svg{display:block;width:100%;height:100%}</style>\n` +
        `<script>${harness(input.seed, input.params ?? {})}<\/script>\n` +
        libs;

    const code = input.code;
    const head = code.match(/<head[^>]*>/i);
    if (head?.index !== undefined) {
        const at = head.index + head[0].length;
        return code.slice(0, at) + "\n" + injected + code.slice(at);
    }
    const html = code.match(/<html[^>]*>/i);
    if (html?.index !== undefined) {
        const at = html.index + html[0].length;
        return code.slice(0, at) + `\n<head>\n${injected}\n</head>` + code.slice(at);
    }
    return `<!doctype html><html><head>\n${injected}\n</head><body>\n${code}\n</body></html>`;
}

export interface RenderResult {
    png: Uint8Array;
    /** `$alea.features()`'s accumulated traits. Empty when the piece reports none. */
    features: Record<string, string>;
}

/**
 * The features attribute's value, out of the page's own serialised HTML.
 * `result.content` is a full document string, not a DOM this process has —
 * there is nothing here to parse it with but the one attribute we put there
 * ourselves, so a regex is the whole job. Malformed or missing never fails a
 * render; a trait is a nice-to-have, a pinned image is not.
 */
/**
 * Throws rather than returning `{}` when the attribute is missing or
 * unparseable — `finish()` always writes it, present and valid, even when
 * the piece called `features()` with nothing (`"{}"`). An attribute that
 * genuinely isn't there, or doesn't parse, means the snapshot or this
 * regex failed, not that the piece has no traits — and `{}` either way
 * would publish that permanently with no error and no retry, same mistake
 * as reading a schema-read failure as "no schema" (see provider.mts).
 */
function featuresFrom(contentHtml: string): Record<string, string> {
    const m = contentHtml.match(/data-alea-features="([^"]*)"/);
    if (!m) throw new Error("data-alea-features attribute missing from the capture");
    const parsed = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    if (!parsed || typeof parsed !== "object") {
        throw new Error("data-alea-features did not parse to an object");
    }
    return parsed;
}

/** Render one piece. Returns the PNG bytes and whatever traits it reported. */
export async function render(input: RenderInput, config: RenderConfig): Promise<RenderResult> {
    const res = await fetch(`${API}/${config.accountId}/browser-rendering/snapshot`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${config.apiToken}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            html: buildDocument(input),
            // Both in one call: the page's HTML, for the features attribute,
            // and the screenshot, in the same browser session /screenshot
            // alone would have opened. No second render, no added cost.
            formats: ["content", "screenshot"],
            viewport: { width: SIZE, height: SIZE, deviceScaleFactor: 1 },
            // Without this the capture lands when the document is ready, which
            // for a generative piece is before it has drawn anything.
            waitForSelector: { selector: "[data-alea-ready]", timeout: CAPTURE_TIMEOUT_MS },
            gotoOptions: { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS },
            screenshotOptions: { type: "png", omitBackground: false },
        }),
        signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS + 15_000),
    });

    if (!res.ok) {
        // The upstream body can carry account detail, so it goes to the log
        // and the caller gets the status.
        console.error("browser-run", res.status, (await res.text()).slice(0, 500));
        throw new Error(`render failed (${res.status})`);
    }

    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
        const json = (await res.json()) as {
            success?: boolean;
            result?: { screenshot?: string; content?: string };
            errors?: unknown;
        };
        const b64 = json.result?.screenshot;
        if (!json.success || !b64) {
            console.error("browser-run", JSON.stringify(json.errors).slice(0, 500));
            throw new Error("render returned no image");
        }
        return {
            png: Uint8Array.from(Buffer.from(b64, "base64")),
            features: featuresFrom(json.result?.content ?? ""),
        };
    }

    // No JSON content type: the body is the image bytes directly, and there
    // is no page HTML alongside it to read features from.
    return { png: new Uint8Array(await res.arrayBuffer()), features: {} };
}
