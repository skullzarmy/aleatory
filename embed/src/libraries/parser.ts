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

const COORDINATE_REGEX =
    /^(@[a-z0-9][a-z0-9._-]*\/)?([a-z0-9][a-z0-9._-]*)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\/(.+))?$/;

/**
 * Extracts an attribute value from an HTML tag string without regular expressions.
 */
function extractAttribute(tag: string, attrName: string): string | null {
    const lower = tag.toLowerCase();
    const needle = `${attrName.toLowerCase()}=`;
    const idx = lower.indexOf(needle);
    if (idx === -1) return null;

    const after = tag.slice(idx + needle.length).trimStart();
    const quote = after[0];
    if (quote === '"' || quote === "'") {
        const endQuote = after.indexOf(quote, 1);
        if (endQuote === -1) return null;
        return after.slice(1, endQuote).trim();
    }

    let end = 0;
    while (
        end < after.length &&
        after[end] !== " " &&
        after[end] !== "\t" &&
        after[end] !== "\n" &&
        after[end] !== "\r" &&
        after[end] !== ">"
    ) {
        end++;
    }
    return after.slice(0, end).trim() || null;
}

/**
 * Strips HTML comments in linear time without regex backtracking.
 */
function stripComments(html: string): string {
    let out = "";
    let cursor = 0;
    while (cursor < html.length) {
        const start = html.indexOf("<!--", cursor);
        if (start === -1) {
            out += html.slice(cursor);
            break;
        }
        out += html.slice(cursor, start);
        const end = html.indexOf("-->", start + 4);
        if (end === -1) {
            break;
        }
        cursor = end + 3;
    }
    return out;
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

    const text = stripComments(html);
    const lower = text.toLowerCase();
    let cursor = 0;

    while (cursor < text.length) {
        const tagStart = lower.indexOf("<meta", cursor);
        if (tagStart === -1) break;

        const tagEnd = lower.indexOf(">", tagStart + 5);
        if (tagEnd === -1) break;

        cursor = tagEnd + 1;
        const tag = text.slice(tagStart, tagEnd);

        const name = extractAttribute(tag, "name");
        if (name?.toLowerCase() !== "alea:library") continue;

        const content = extractAttribute(tag, "content");
        if (!content || seen.has(content)) continue;
        seen.add(content);

        const spec = parseCoordinate(content);
        if (spec) {
            specs.push(spec);
        } else {
            unknown.push(content);
        }
    }

    return { specs, unknown };
}
