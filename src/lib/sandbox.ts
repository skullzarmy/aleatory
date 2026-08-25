/**
 * Aleatory, sandbox document builder.
 *
 * Takes an artist's HTML document, injects the harness, the resolved
 * dependencies and a locked-down CSP, and returns a single self-contained
 * document to hand to a sandboxed srcdoc frame.
 *
 * Two rules shape everything here:
 *
 *  1. Dependency resolution is a PRE-RENDER step. Libraries are inlined into
 *     the document before it ever runs, exactly as they will be when they come
 *     from the on-chain Deps contract instead of a manifest. The piece itself
 *     never touches the network, the CSP makes that structural, not advisory.
 *  2. The harness must run before anything the artist wrote, or the PRNG and
 *     the network overrides land too late to mean anything.
 */
import { HARNESS_SOURCE, type HarnessConfig } from "./runtime";

/**
 * default-src 'none' is the whole point: the frame can render, and it can do
 * nothing else. Violations surface through the securitypolicyviolation
 * listener in the harness, so a piece reaching for a CDN is reported rather
 * than quietly half-working.
 *
 * 'unsafe-eval' is allowed because several established art libraries build
 * shaders and helpers with Function(); it grants no network reach.
 */
const CSP =
    "default-src 'none'; " +
    "script-src 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'unsafe-inline'; " +
    "img-src data: blob:; " +
    "media-src data: blob:; " +
    "font-src data:; " +
    "connect-src 'none'; " +
    "frame-src 'none'; " +
    "object-src 'none'; " +
    "base-uri 'none'; " +
    "form-action 'none'";

const RESET = `
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}
canvas{display:block}
svg{display:block;width:100%;height:100%}
`;

/** `</script>` inside an inline script would close it early. */
function safeForScriptTag(source: string): string {
    return source.replace(/<\/script/gi, "<\\/script");
}

export interface SandboxOptions extends HarnessConfig {
    /** Dependency sources, inlined in order between the harness and the artist code. */
    deps?: string[];
}

/**
 * Build the complete sandbox document.
 *
 * `html` is the artist's index.html with its own local files already inlined
 * (see packageProject). Injection goes as early as the document allows so the
 * CSP covers everything and the harness wins every race.
 */
export function buildSandboxDoc(html: string, opts: SandboxOptions): string {
    const config: HarnessConfig = {
        seed: opts.seed,
        params: opts.params ?? {},
        paramsSchema: opts.paramsSchema ?? [],
        wantImage: opts.wantImage,
        timeout: opts.timeout,
    };

    const harness = HARNESS_SOURCE.replace("__GX_CONFIG__", safeForScriptTag(JSON.stringify(config)));
    const deps = (opts.deps ?? []).map((src) => `<script>${safeForScriptTag(src)}</script>`).join("\n");

    const injected =
        `<meta charset="utf-8">\n` +
        `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
        `<style>${RESET}</style>\n` +
        `<script>${harness}</script>\n` +
        deps;

    const headOpen = html.match(/<head[^>]*>/i);
    if (headOpen?.index !== undefined) {
        const at = headOpen.index + headOpen[0].length;
        return html.slice(0, at) + "\n" + injected + html.slice(at);
    }
    const htmlOpen = html.match(/<html[^>]*>/i);
    if (htmlOpen?.index !== undefined) {
        const at = htmlOpen.index + htmlOpen[0].length;
        return html.slice(0, at) + `\n<head>\n${injected}\n</head>` + html.slice(at);
    }
    return `<!doctype html><html><head>\n${injected}\n</head><body>\n${html}\n</body></html>`;
}

/** A fresh 256-bit seed, hex. Used for sandbox runs, minted pieces derive
 *  theirs from chain state instead (see record.deriveSeed). */
export function randomSeed(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deterministic seed sequence for grid previews, so the grid is stable across
 *  reloads and shareable by its base seed. */
export function seedAt(base: string, index: number): string {
    // Mix the index into the base with a cheap avalanche, good enough to
    // decorrelate neighbouring grid cells, and reproducible anywhere.
    let h1 = 0x811c9dc5 ^ index;
    let h2 = 0x9e3779b9 + index * 0x85ebca6b;
    for (let i = 0; i < base.length; i++) {
        h1 = Math.imul(h1 ^ base.charCodeAt(i), 16777619) >>> 0;
        h2 = Math.imul(h2 + base.charCodeAt(i), 2246822519) >>> 0;
    }
    let out = "";
    let a = h1 >>> 0;
    let b = h2 >>> 0;
    for (let i = 0; i < 8; i++) {
        a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
        b = (Math.imul(b ^ a, 2246822519) + 374761393) >>> 0;
        out += (a ^ b).toString(16).padStart(8, "0");
    }
    return out.slice(0, 64);
}
