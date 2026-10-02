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
