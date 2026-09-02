/**
 * Which libraries a generator asks for, read from the generator itself.
 *
 *   <meta name="alea:library" content="p5@1.5.0">
 *
 * The document is the source of truth, not a field beside it. An artist can
 * download a template, work on it in their own editor for a week, and upload it
 * again, and the file still says what it needs. Anything held only in our
 * database would be lost on the first round trip.
 *
 * One tag per library, so a piece wanting two says so twice, and the order they
 * appear in is the order they load in.
 */
import { type DepSpec } from "./runtimes";

const TAG = /<meta\s+[^>]*name\s*=\s*["']alea:library["'][^>]*>/gi;
const CONTENT = /content\s*=\s*["']([^"']+)["']/i;

/**
 * Two names the picker offers, so nobody types coordinates from memory.
 *
 * Not a list of what may be declared. Any package on npm may be.
 */
export const SUGGESTED = ["p5@1.5.0", "three@0.160.1"] as const;

/** `d3@7.9.0`, or `d3@7.9.0/dist/d3.min.js` when the file has to be named. */
const COORDINATE =
    /^(@[a-z0-9][a-z0-9._-]*\/)?([a-z0-9][a-z0-9._-]*)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\/(.+))?$/;

/**
 * A declaration, read into something resolvable.
 *
 * Any package on npm works. The proxy fetches it from jsDelivr, checks it
 * against the digest published for that exact file, and answers with the
 * blake2b recorded when the piece is published. Nothing needs to know a
 * library in advance, which is why there is no list of them.
 *
 * The file is optional: without one the package's own default browser build is
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
    for (const tag of html.match(TAG) ?? []) {
        const value = tag.match(CONTENT)?.[1]?.trim();
        if (value && !out.includes(value)) out.push(value);
    }
    return out;
}

/**
 * A document's declarations, resolved.
 *
 * `unknown` is what is malformed: something that is not `name@version`. A
 * well-formed coordinate npm does not have fails when it is fetched, with the
 * registry saying so, rather than being guessed at here.
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
 * Rewrite a document's declarations to exactly this set.
 *
 * Existing tags are removed and the new ones inserted at the top of `<head>`,
 * so switching library in the studio edits the artist's file rather than
 * keeping a preference somewhere they cannot see. What they export is what
 * we run.
 */
export function withLibraries(html: string, coordinates: string[]): string {
    // The tag and the line it sat on, so removing one does not leave a gap
    // behind in the artist's file.
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
