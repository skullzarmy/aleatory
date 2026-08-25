/**
 * Aleatory, packaging.
 *
 * The v0 package format is a single self-contained HTML document. A .zip in
 * the shape artists already ship (index.html at the root, a libraries/ folder,
 * a stylesheet) is accepted and flattened into one, because the point is that
 * work made for the old flow runs here untouched.
 *
 * Flattening is a pre-render step, like dependency resolution: by the time a
 * piece boots it is one document with no local references and no network.
 */
import { strFromU8, unzipSync } from "fflate";

export interface PackagedProject {
    html: string;
    /** Total bytes of the flattened document, what the cost estimate prices. */
    bytes: number;
    /** Human notes about what was inlined and what could not be resolved. */
    notes: string[];
    /** Files that were referenced but not found in the package. */
    unresolved: string[];
}

const TEXT_INLINE = new Set(["js", "mjs", "css"]);

const MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    json: "application/json",
};

function ext(path: string): string {
    const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : "";
}

function normalize(path: string): string {
    return path.replace(/^\.\//, "").replace(/^\//, "").split("?")[0].split("#")[0];
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/** Escape a replacement string so `$&` and friends in file contents survive. */
function literal(replacement: string): string {
    return replacement.replace(/\$/g, "$$$$");
}

export function packageFromHtml(html: string): PackagedProject {
    return {
        html,
        bytes: new TextEncoder().encode(html).length,
        notes: [],
        unresolved: [],
    };
}

/**
 * Flatten a zipped project into one document.
 *
 * Handles the common shapes: index.html at the root, or a single wrapper
 * folder containing it (what every OS produces when you zip a directory).
 */
export function packageFromZip(data: Uint8Array): PackagedProject {
    const files = unzipSync(data);
    const paths = Object.keys(files).filter((p) => !p.endsWith("/") && !p.includes("__MACOSX"));

    // index.html at the root, else the shallowest one anywhere.
    const candidates = paths.filter((p) => p.toLowerCase().endsWith("index.html"));
    if (candidates.length === 0) {
        throw new Error("No index.html found in the zip. The entry point must be index.html.");
    }
    candidates.sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
    const entry = candidates[0];
    const root = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/") + 1) : "";

    // Everything is addressed relative to the folder index.html lives in.
    const byPath = new Map<string, Uint8Array>();
    for (const p of paths) {
        if (root && p.startsWith(root)) byPath.set(p.slice(root.length), files[p]);
        byPath.set(p, files[p]);
    }

    let html = strFromU8(files[entry]);
    const notes: string[] = [];
    const unresolved: string[] = [];

    const lookup = (raw: string): Uint8Array | undefined => {
        const key = normalize(raw);
        if (/^(https?:|data:|blob:)/i.test(raw)) return undefined;
        return byPath.get(key) ?? byPath.get(root + key);
    };

    // <script src="…"></script> → inline
    html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (match, _pre, src: string) => {
        if (/^(https?:)?\/\//.test(src)) {
            notes.push(`Left a remote script reference in place: ${src}, it will be blocked and reported at render time.`);
            return match;
        }
        const file = lookup(src);
        if (!file) {
            unresolved.push(src);
            return match;
        }
        if (!TEXT_INLINE.has(ext(src))) return match;
        return `<script>${literal(strFromU8(file))}</script>`;
    });

    // <link rel="stylesheet" href="…"> → inline
    html = html.replace(/<link\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>/gi, (match, href: string) => {
        if (!/stylesheet/i.test(match)) return match;
        const file = lookup(href);
        if (!file) {
            if (!/^(https?:)?\/\//.test(href)) unresolved.push(href);
            return match;
        }
        return `<style>${literal(strFromU8(file))}</style>`;
    });

    // Any remaining src="…" (images, audio, video) → data URI
    html = html.replace(/\bsrc\s*=\s*["']([^"']+)["']/gi, (match, src: string) => {
        const file = lookup(src);
        if (!file) return match;
        const mime = MIME[ext(src)] ?? "application/octet-stream";
        return `src="data:${mime};base64,${literal(toBase64(file))}"`;
    });

    const inlinedCount = paths.length - 1 - unresolved.length;
    if (inlinedCount > 0) notes.push(`Flattened ${inlinedCount} file${inlinedCount === 1 ? "" : "s"} into one document.`);

    return {
        html,
        bytes: new TextEncoder().encode(html).length,
        notes,
        unresolved,
    };
}

/** Read a dropped/selected file into a package. */
export async function packageFromFile(file: File): Promise<PackagedProject> {
    if (file.name.toLowerCase().endsWith(".zip")) {
        const buf = new Uint8Array(await file.arrayBuffer());
        return packageFromZip(buf);
    }
    if (/\.html?$/i.test(file.name)) {
        return packageFromHtml(await file.text());
    }
    throw new Error("Drop a single .html file or a .zip with index.html at the root.");
}

/** Trigger a browser download of arbitrary text. */
export function downloadText(filename: string, text: string, mime = "text/html"): void {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
