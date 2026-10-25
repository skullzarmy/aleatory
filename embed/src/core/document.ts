import { buildHarnessScript } from "./harness.js";
import type { DocumentOptions } from "./types.js";

/** Default CSP blocking network while allowing inline execution. */
export const DEFAULT_CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join("; ");

/** Default reset style for full-bleed rendering. */
export const DEFAULT_FRAME_STYLE =
    "html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}" +
    "canvas{display:block}svg{display:block;width:100%;height:100%}";

/**
 * Finds the end offset of an opening HTML tag in linear time without regex backtracking.
 */
function findOpenTagEnd(html: string, tagName: string): number {
    const lower = html.toLowerCase();
    const tagPrefix = `<${tagName}`;
    let idx = 0;
    while (idx < html.length) {
        const found = lower.indexOf(tagPrefix, idx);
        if (found === -1) return -1;
        const nextChar = lower[found + tagPrefix.length];
        if (
            nextChar === ">" ||
            nextChar === " " ||
            nextChar === "\t" ||
            nextChar === "\n" ||
            nextChar === "\r" ||
            nextChar === "/"
        ) {
            const close = lower.indexOf(">", found + tagPrefix.length);
            if (close !== -1) {
                return close + 1;
            }
        }
        idx = found + 1;
    }
    return -1;
}

/**
 * Assembles a self-contained HTML document with canonical harness and dependencies.
 */
export function buildDocument(options: DocumentOptions): string {
    const harness = buildHarnessScript(options);
    const libs = (options.deps ?? [])
        .map((src) => `<script>${String(src).replace(/<\/script/gi, "<\\/script")}<\/script>`)
        .join("\n");

    const injected =
        `<meta charset="utf-8">\n` +
        `<meta http-equiv="Content-Security-Policy" content="${DEFAULT_CSP}">\n` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
        `<style id="alea-frame">${DEFAULT_FRAME_STYLE}</style>\n` +
        `<script>${harness}<\/script>\n` +
        (libs ? `${libs}\n` : "");

    const code = options.code;
    const headEnd = findOpenTagEnd(code, "head");
    if (headEnd !== -1) {
        return code.slice(0, headEnd) + "\n" + injected + code.slice(headEnd);
    }

    const htmlEnd = findOpenTagEnd(code, "html");
    if (htmlEnd !== -1) {
        return `${code.slice(0, htmlEnd)}\n<head>\n${injected}</head>${code.slice(htmlEnd)}`;
    }

    return `<!doctype html><html><head>\n${injected}</head><body>\n${code}\n</body></html>`;
}
