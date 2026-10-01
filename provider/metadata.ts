/**
 * The two documents that get pinned and pointed at from chain: a generator's
 * pending document, which every piece carries until a provider publishes its
 * own, and a piece's own document once it is rendered.
 *
 * The deploy form works in relative royalty terms, a total and who splits it,
 * and the objkt convention stores absolute shares against the sale price with
 * `decimals` as the divisor. 25% split evenly between two wallets is
 * `decimals: 4` with shares of 1250 each.
 */

export const ROYALTY_DECIMALS = 4;
const SCALE = 10 ** ROYALTY_DECIMALS;

export interface RoyaltyRecipient {
    address: string;
    /** Share of the royalty total, in percent. All rows sum to 100. */
    percent: number;
}

export interface RoyaltySplit {
    /** Total royalty on each sale, in percent. */
    totalPercent: number;
    recipients: RoyaltyRecipient[];
}

/**
 * Absolute shares against the sale price, in the shape objkt and Teia read.
 * Every share is floored and the remainder goes to the first recipient, so the
 * shares sum to exactly the declared total.
 */
export function encodeRoyalties(split: RoyaltySplit): {
    decimals: number;
    shares: Record<string, number>;
} {
    const total = Math.round((split.totalPercent / 100) * SCALE);
    const shares: Record<string, number> = {};
    if (total === 0 || split.recipients.length === 0) {
        return { decimals: ROYALTY_DECIMALS, shares };
    }

    let assigned = 0;
    for (const r of split.recipients) {
        const share = Math.floor((total * r.percent) / 100);
        shares[r.address] = (shares[r.address] ?? 0) + share;
        assigned += share;
    }

    const first = split.recipients[0].address;
    shares[first] += total - assigned;

    return { decimals: ROYALTY_DECIMALS, shares };
}

/** Basis points per recipient, which is what the generator stores on chain. */
export function royaltiesToBps(split: RoyaltySplit): Record<string, number> {
    const { shares } = encodeRoyalties(split);
    // decimals 4 means the share is already in basis points.
    return shares;
}

/** What a recipient actually receives on a sale, for the deploy preview. */
export function royaltyPreview(split: RoyaltySplit): { address: string; percentOfSale: number }[] {
    const { shares } = encodeRoyalties(split);
    return Object.entries(shares).map(([address, share]) => ({
        address,
        percentOfSale: (share / SCALE) * 100,
    }));
}

/**
 * The generator's declared tags, trimmed/deduped/length-and-count-capped —
 * same "never produce a broken document" bar as `pieceName`'s nameTrait
 * handling. A tag is free text an artist typed, not a bounded param, so this
 * is the one place that bounds it before it reaches any document.
 */
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;
export function cleanTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of raw) {
        if (typeof t !== "string") continue;
        const trimmed = t.trim().slice(0, MAX_TAG_LENGTH);
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
        if (out.length >= MAX_TAGS) break;
    }
    return out;
}

export interface PendingDocInput {
    generatorName: string;
    description?: string;
    /** The generator's declared tags (TZIP-21, standard — not an `aleatory:` key). */
    tags?: string[];
    artist: string;
    placeholderImageUri: string;
    split: RoyaltySplit;
}

export function buildPendingDocument(input: PendingDocInput) {
    const tags = cleanTags(input.tags);
    return {
        name: `${input.generatorName}`,
        description:
            input.description ||
            "This piece is awaiting its render. It is owned and tradeable now.",
        decimals: 0,
        isBooleanAmount: false,
        shouldPreferSymbol: false,
        creators: [input.artist],
        // Same placeholder as displayUri/thumbnailUri — a missing or empty
        // artifactUri is read by objkt as "no real content" and the token is
        // excluded from the grid even though it is owned and tradeable now.
        artifactUri: input.placeholderImageUri,
        displayUri: input.placeholderImageUri,
        thumbnailUri: input.placeholderImageUri,
        royalties: encodeRoyalties(input.split),
        ...(tags.length > 0 ? { tags } : {}),
    };
}

export interface PieceDocInput extends Omit<PendingDocInput, "split" | "placeholderImageUri"> {
    tokenId: number;
    /**
     * Already encoded, `{ decimals, shares }`. A generator stores its royalties
     * as basis points and TZIP-21 with `decimals: 4` is the same unit, so a
     * provider publishes what the contract holds.
     */
    royalties: { decimals: number; shares: Record<string, number> };
    /**
     * The rendered image, same as `imageUri` — there is no separate pinned,
     * per-piece interactive artifact today, only the generator's shared,
     * unparameterized source. A marketplace that requires a non-empty
     * `artifactUri` to treat a token as real, displayable content (objkt
     * does) got an empty string here before: `piece.codeUri`, the
     * generator's own external code pointer, empty for the common inline
     * case and, even set, identical across every piece in the edition.
     */
    artifactUri: string;
    imageUri: string;
    seed: string;
    params?: Record<string, unknown>;
    /** `$alea.features()`'s accumulated traits. Empty or absent when the piece reports none. */
    features?: Record<string, string>;
    /** The generator's declared tags, as of this piece's own publish time. */
    tags?: string[];
    /**
     * The generator's opt-in declaration (`aleatory:nameTrait`), naming which
     * feature key, if any, becomes part of each piece's name. Absent for
     * every generator that didn't ask for this — the overwhelming majority —
     * which get the plain name exactly as before.
     */
    nameTrait?: string;
    codeHash: string;
}

/** `[collection name] #[n]`, the convention every indexer expects (docs/decisions.md §11). */
function plainName(generatorName: string, tokenId: number): string {
    return `${generatorName} #${tokenId + 1}`;
}

/**
 * The opt-in suffix: `[collection name] #[n] · [trait value]`. Never throws
 * and never produces a half-formed name — anything that isn't a clean,
 * present, reasonably-sized string value for the declared key falls all the
 * way back to the plain form, same as a generator that never opted in.
 */
function pieceName(input: PieceDocInput): string {
    const plain = plainName(input.generatorName, input.tokenId);
    const trait = input.nameTrait?.trim();
    if (!trait) return plain;

    const raw = input.features?.[trait];
    if (raw === undefined || raw === null) return plain;

    const value = String(raw).trim();
    if (!value) return plain;

    // A trait value is free text from the artist's own code, not a declared,
    // bounded param — cap it so one piece's name cannot dwarf every other
    // field in the document it shares an operation with.
    const MAX_SUFFIX = 60;
    const suffix = value.length > MAX_SUFFIX ? `${value.slice(0, MAX_SUFFIX)}…` : value;
    return `${plain} · ${suffix}`;
}

/**
 * The document a provider publishes for one piece. The only builder, so no
 * provider assembles its own and drifts from the name and royalties every other
 * piece carries.
 */
export function buildPieceDocument(input: PieceDocInput) {
    const tags = cleanTags(input.tags);
    return {
        name: pieceName(input),
        description: input.description || "",
        decimals: 0,
        isBooleanAmount: false,
        shouldPreferSymbol: false,
        creators: [input.artist],
        artifactUri: input.artifactUri,
        displayUri: input.imageUri,
        thumbnailUri: input.imageUri,
        royalties: input.royalties,
        ...(tags.length > 0 ? { tags } : {}),
        aleaSeed: input.seed,
        aleaCodeHash: input.codeHash,
        aleaParams: input.params ? JSON.stringify(input.params) : "",
        // Traits first, then params — declared features are what the artist
        // meant to be shown to a collector; params are inputs that happen to
        // also be readable. Order is not spec-mandated, just a pick.
        attributes: [
            ...Object.entries(input.features ?? {}).map(([name, value]) => ({
                name,
                value: String(value),
            })),
            ...Object.entries(input.params ?? {}).map(([name, value]) => ({
                name,
                value: String(value),
            })),
        ],
    };
}
