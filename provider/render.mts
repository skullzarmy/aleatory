/**
 * Rendering a piece, through Cloudflare Browser Run.
 *
 * In: the generator's source, a seed, parameters. Out: PNG bytes.
 *
 * This replaces a Worker that used the old `env.BROWSER` binding with
 * `@cloudflare/puppeteer`. Browser Rendering became Browser Run and the
 * binding shape went with it; there is now a REST endpoint that takes raw
 * HTML, so there is no Worker to deploy, no `workers.dev` URL, and no shared
 * secret guarding one. The secret only ever existed because a `workers.dev`
 * URL is public, and a call made from here needs no such thing.
 *
 * This is the provider's half of the two harness implementations. The other is
 * `isolate/index.html`, which draws for a viewer. They agree by conforming to
 * ALEATORY-001 §7, not by sharing a file, and they have to: a piece must look
 * the same in a browser as it does in the image that ends up on chain. When
 * they disagreed on seeding, every piece rendered from one identical stream.
 */

const API = "https://api.cloudflare.com/client/v4/accounts";

/** Long edge of a rendered piece. */
const SIZE = 1000;

/**
 * How long to wait for a piece to signal.
 *
 * A generator sets its own capture point and cannot be trusted to reach it, so
 * this is the ceiling, not the artist's timeout.
 */
const CAPTURE_TIMEOUT_MS = 20_000;

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
    // Both spellings, because CLOUDFLARE_* is what Cloudflare's own tooling
    // reads and CF_* is shorter to type. Neither is worth a rename.
    const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
    const apiToken = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
    if (!accountId || !apiToken) return null;
    return { accountId, apiToken };
}

/**
 * The determinism harness.
 *
 * Kept in step with `isolate/index.html` by hand, with one addition: it marks
 * the document when the piece signals, so the renderer has a selector to wait
 * on. A screenshot taken before that point catches the piece mid-draw, and a
 * half-drawn render published on chain is permanent.
 */
function harness(seed: string, params: Record<string, unknown>): string {
    const config = JSON.stringify({ seed, params }).replace(/<\/script/gi, "<\\/script");
    return `
(function () {
  "use strict";
  var CFG = ${config};

  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

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
    // What the renderer waits on. An attribute rather than a global, because
    // a selector is the only thing the screenshot endpoint can watch for.
    document.documentElement.setAttribute("data-alea-ready", "1");
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
 * Assemble the document.
 *
 * Injected as early as the document allows, so the CSP covers everything and
 * the harness wins every race against the artist's first line.
 */
export function buildDocument(input: RenderInput): string {
    const csp = [
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval'",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "media-src data: blob:",
        "font-src data:",
        // The control. A piece that fetches would otherwise render against
        // something external and stop being reproducible.
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

/** Render one piece. Returns PNG bytes. */
export async function render(input: RenderInput, config: RenderConfig): Promise<Uint8Array> {
    const res = await fetch(`${API}/${config.accountId}/browser-rendering/screenshot`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${config.apiToken}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            html: buildDocument(input),
            viewport: { width: SIZE, height: SIZE, deviceScaleFactor: 1 },
            // Wait for the piece to say it is finished. Without this the
            // capture lands whenever the document happens to be ready, which
            // for a generative piece is usually before it has drawn anything.
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
            result?: { screenshot?: string };
            errors?: unknown;
        };
        const b64 = json.result?.screenshot;
        if (!json.success || !b64) {
            console.error("browser-run", JSON.stringify(json.errors).slice(0, 500));
            throw new Error("render returned no image");
        }
        return Uint8Array.from(Buffer.from(b64, "base64"));
    }

    return new Uint8Array(await res.arrayBuffer());
}
