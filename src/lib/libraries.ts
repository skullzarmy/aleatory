/**
 * Which libraries a generator asks for, read from the generator itself.
 *
 *   <meta name="alea:library" content="p5@1.5.0">
 *
 * The document is the source of truth, so a file that leaves here and comes
 * back still says what it needs. One tag per library, and they load in the
 * order they appear.
 */
import { LIBRARIES, type DepSpec } from "./kinds";

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

    // A package we carry a checked digest and a local copy for. The proxy would
    // arrive at the same bytes, but this digest is one somebody verified against
    // npm rather than one a mirror taught us. Shared, so nothing may mutate it.
    const pinned = LIBRARIES.find(
        (l) => l.id === id && l.version === version && (path === "" || l.registry.path === path),
    );
    if (pinned) return pinned;

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

/** One entry of `aleatory:libraries`. ALEATORY-001 §1. */
export interface RecordedLibrary {
    id: string;
    version: string;
    path: string;
    hash: string;
}

/**
 * A record, or the reasons there is none. A union rather than a pair, so half a
 * record is not something a caller can reach for.
 */
export type LibraryRecord =
    | { ok: true; libraries: RecordedLibrary[] }
    | { ok: false; problems: string[] };

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * What goes on chain for a document, built from what that document declares and
 * from the specs those declarations actually resolved to.
 *
 * The record is written at origination and has no setter, and a renderer must
 * refuse to draw without it, so anything short of a complete answer is a refusal
 * here rather than a generator nobody can ever render.
 */
export function recordFor(html: string, resolved: DepSpec[]): LibraryRecord {
    const libraries: RecordedLibrary[] = [];
    const problems: string[] = [];
    const seen = new Map<string, string>();

    // Declaration order, because that is load order.
    for (const coordinate of declaredIn(html)) {
        const want = specFor(coordinate);
        if (!want) {
            problems.push(
                `${coordinate} is not a package and a version, so nothing can resolve it.`,
            );
            continue;
        }

        const got = resolved.find(
            (s) =>
                s.id === want.id &&
                s.version === want.version &&
                // A bare coordinate takes whichever file the package defaults to.
                (want.registry.path === "" || s.registry.path === want.registry.path),
        );
        if (!got) {
            problems.push(`${coordinate} has not been loaded, so there is nothing to record.`);
            continue;
        }
        if (!DIGEST.test(got.hash)) {
            problems.push(
                `${coordinate} resolved without a digest, and a renderer must refuse to draw without one.`,
            );
            continue;
        }
        // The renderer builds its URL from this, so an empty one resolves nowhere.
        if (got.registry.path === "") {
            problems.push(`${coordinate} resolved without naming a file inside the package.`);
            continue;
        }

        const already = seen.get(got.id);
        if (already && already !== got.version) {
            problems.push(
                `${got.id} is declared at ${already} and at ${got.version}. Only one can load.`,
            );
            continue;
        }
        seen.set(got.id, got.version);

        libraries.push({
            id: got.id,
            version: got.version,
            path: got.registry.path,
            hash: got.hash,
        });
    }

    return problems.length > 0 ? { ok: false, problems } : { ok: true, libraries };
}
