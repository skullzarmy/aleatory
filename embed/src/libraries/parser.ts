/**
 * A declared library dependency coordinate.
 */
export interface LibrarySpec {
    /** The package name, including scope if present (e.g. "p5" or "@org/pkg"). */
    id: string;
    /** The pinned semver version string (e.g. "1.5.0"). */
    version: string;
    /** The file path within the package, or empty string for default browser entry. */
    path: string;
    /** Expected blake2b-256 hex hash from on-chain metadata, if known. */
    hash?: string;
}

const TAG_REGEX = /<meta\s+[^>]*name\s*=\s*["']alea:library["'][^>]*>/gi;
const CONTENT_REGEX = /content\s*=\s*["']([^"']+)["']/i;
const COORDINATE_REGEX =
    /^(@[a-z0-9][a-z0-9._-]*\/)?([a-z0-9][a-z0-9._-]*)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\/(.+))?$/;

/**
 * Strips HTML comments so commented examples are ignored.
 */
function stripComments(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Parses a single package coordinate string into a LibrarySpec.
 */
export function parseCoordinate(coordinate: string, hash?: string): LibrarySpec | null {
    const trimmed = coordinate.trim();
    const match = COORDINATE_REGEX.exec(trimmed);
    if (!match) return null;

    const [, scope = "", name, version, path = ""] = match;
    return {
        id: `${scope}${name}`,
        version,
        path,
        hash,
    };
}

/**
 * Extracts and parses all <meta name="alea:library"> declarations from HTML source.
 */
export function parseLibraries(html: string): { specs: LibrarySpec[]; unknown: string[] } {
    const specs: LibrarySpec[] = [];
    const unknown: string[] = [];
    const seen = new Set<string>();

    for (const tag of stripComments(html).match(TAG_REGEX) ?? []) {
        const value = tag.match(CONTENT_REGEX)?.[1]?.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);

        const spec = parseCoordinate(value);
        if (spec) {
            specs.push(spec);
        } else {
            unknown.push(value);
        }
    }

    return { specs, unknown };
}
