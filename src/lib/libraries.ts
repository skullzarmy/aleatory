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
import { LIBRARIES, RUNTIME_KINDS, type DepSpec } from "./runtimes";

const TAG = /<meta\s+[^>]*name\s*=\s*["']alea:library["'][^>]*>/gi;
const CONTENT = /content\s*=\s*["']([^"']+)["']/i;

/** Every library the catalogue knows, by `id@version`. */
export const CATALOGUE: DepSpec[] = [
    ...new Map(
        [...LIBRARIES, ...RUNTIME_KINDS.flatMap((k) => k.deps)].map((d) => [
            `${d.id}@${d.version}`,
            d,
        ]),
    ).values(),
];

export function specFor(coordinate: string): DepSpec | null {
    return CATALOGUE.find((d) => `${d.id}@${d.version}` === coordinate) ?? null;
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
 * Resolve a document's declarations against the catalogue.
 *
 * Unknown coordinates come back separately rather than being dropped. A piece
 * asking for something we cannot supply is a thing the artist has to be told
 * about, not a silently missing library and a blank frame.
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

    const tags = coordinates
        .map((c) => `  <meta name="alea:library" content="${c}">`)
        .join("\n");

    if (/<head[^>]*>/i.test(stripped)) {
        return stripped.replace(/<head[^>]*>/i, (m) => `${m}\n${tags}`);
    }
    if (/<html[^>]*>/i.test(stripped)) {
        return stripped.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${tags}\n</head>`);
    }
    return `${tags}\n${stripped}`;
}
