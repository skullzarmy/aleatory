/**
 * The TZIP fields every generator's `content` document should carry, and the
 * gap between that and what a generator deployed before they existed
 * actually has.
 *
 * `symbol` is deliberately not here: objkt's `fa` type has no `symbol` field
 * at all. It is a per-token field, handled in `provider/metadata.ts`, not
 * something a generator's own contract metadata carries.
 */
import { siteUrl } from "./config";

/** Which of the fields below `content` is missing, if any. */
export function missingTzipFields(content: Record<string, unknown>): string[] {
    const missing: string[] = [];
    if (!content.homepage) missing.push("homepage");
    const interfaces = Array.isArray(content.interfaces) ? content.interfaces : [];
    if (!interfaces.includes("TZIP-021")) missing.push("TZIP-021");
    return missing;
}

/**
 * Who `content.authors` credits against who the generator's storage says has
 * confirmed. The two drift the moment a collaborator accepts, because
 * `authors` is written once at deploy and `accept_collaboration` does not
 * touch it.
 *
 * This is for marketplaces that read the document and never the storage. The
 * site reads `collab.confirmed` directly, so it is never waiting on a push.
 */
export function authorsAreStale(content: Record<string, unknown>, confirmed: string[]): boolean {
    const authors = Array.isArray(content.authors)
        ? content.authors.filter((a): a is string => typeof a === "string")
        : [];
    if (confirmed.length === 0) return false;
    return (
        authors.length !== confirmed.length ||
        [...authors].sort().join(",") !== [...confirmed].sort().join(",")
    );
}

/** `content` crediting exactly who has confirmed. Everything else passes through untouched. */
export function patchAuthors(
    content: Record<string, unknown>,
    confirmed: string[],
): Record<string, unknown> {
    return { ...content, authors: [...confirmed].sort() };
}

/** `content` with every field `missingTzipFields` would flag filled in. Everything else passes through untouched. */
export function patchTzipFields(content: Record<string, unknown>): Record<string, unknown> {
    const interfaces = Array.isArray(content.interfaces) ? [...content.interfaces] : [];
    if (!interfaces.includes("TZIP-021")) interfaces.push("TZIP-021");
    return {
        ...content,
        interfaces,
        homepage: content.homepage || siteUrl(),
    };
}
