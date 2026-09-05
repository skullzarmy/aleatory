/**
 * Which libraries a generator asks for, read from the generator itself.
 *
 *   <meta name="alea:library" content="p5@1.5.0">
 *
 * The document is the source of truth, so a file that leaves here and comes
 * back still says what it needs. One tag per library, and they load in the
 * order they appear.
 */
import { type DepSpec } from "./kinds";

const TAG = /<meta\s+[^>]*name\s*=\s*["']alea:library["'][^>]*>/gi;
const CONTENT = /content\s*=\s*["']([^"']+)["']/i;

/**
 * A commented tag is an example, not a declaration. Templates and readmes show
 * the tag inside `<!-- -->` to say what one looks like.
 */
const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

/**
 * What the picker offers, so nobody types coordinates from memory. Not a list
 * of what may be declared: any package on npm may be.
 */
export const SUGGESTED = ["p5@1.5.0", "three@0.160.1"] as const;

/** `d3@7.9.0`, or `d3@7.9.0/dist/d3.min.js` when the file has to be named. */
const COORDINATE =
    /^(@[a-z0-9][a-z0-9._-]*\/)?([a-z0-9][a-z0-9._-]*)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\/(.+))?$/;

/**
 * A declaration, read into something resolvable. The proxy fetches any npm
 * package from jsDelivr, checks it against the digest published for that exact
 * file, and answers with the blake2b recorded at publish, so nothing has to
 * know a library in advance.
 *
 * The file is optional: without one the package's default browser build is
 * used, which is what `p5@1.5.0` means.
 */
export function specFor(coordinate: string): DepSpec | null {
    const m = COORDINATE.exec(coordinate.trim());
    if (!m) return null;
    const [, scope = "", name, version, path = ""] = m;
    const id = `${scope}${name}`;
    return {
        id,
        label: id,
        version,
        registry: { integrity: "", path },
        approxBytes: 0,
        hash: "",
    };
}

/** The coordinates a document declares, in order, deduplicated. */
export function declaredIn(html: string): string[] {
    const out: string[] = [];
    for (const tag of stripComments(html).match(TAG) ?? []) {
        const value = tag.match(CONTENT)?.[1]?.trim();
        if (value && !out.includes(value)) out.push(value);
    }
    return out;
}

/**
 * A document's declarations, resolved. `unknown` is what is malformed. A
 * well-formed coordinate npm does not have fails when it is fetched, with the
 * registry saying so.
 */
export function librariesIn(html: string): { specs: DepSpec[]; unknown: string[] } {
    const specs: DepSpec[] = [];
    const unknown: string[] = [];
    for (const coordinate of declaredIn(html)) {
        const spec = specFor(coordinate);
        if (spec) specs.push(spec);
        else unknown.push(coordinate);
    }
    return { specs, unknown };
}

/**
 * Rewrite a document's declarations to exactly this set. Existing tags are
 * removed and the new ones inserted at the top of `<head>`, so switching
 * library in the studio edits the artist's file and what they export is what we
 * run.
 */
export function withLibraries(html: string, coordinates: string[]): string {
    // The tag and the line it sat on, so removing one leaves no gap behind.
    const stripped = html.replace(
        /^[ \t]*<meta\s+[^>]*name\s*=\s*["']alea:library["'][^>]*>[ \t]*\r?\n?/gim,
        "",
    );

    if (coordinates.length === 0) return stripped;

    const tags = coordinates.map((c) => `  <meta name="alea:library" content="${c}">`).join("\n");

    if (/<head[^>]*>/i.test(stripped)) {
        return stripped.replace(/<head[^>]*>/i, (m) => `${m}\n${tags}`);
    }
    if (/<html[^>]*>/i.test(stripped)) {
        return stripped.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${tags}\n</head>`);
    }
    return `${tags}\n${stripped}`;
}
