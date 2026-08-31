/**
 * Builds the documents that get pinned and pointed at from chain.
 *
 * Two of them. The collection's pending document, which every piece carries
 * until a provider publishes its own, and a piece's own document once it has
 * been rendered.
 *
 * Royalty encoding is the part to get right: the form works in relative terms
 * (a total, then who splits it), and the objkt convention stores absolute
 * shares against the sale price with `decimals` as the divisor. 25% split
 * evenly between two wallets is `decimals: 4` with shares of 1250 each.
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
 *
 * Splits rarely divide evenly, so every share is floored and the leftover
 * goes to the first recipient. The shares then sum to exactly the declared
 * total, every time.
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

/** Basis points per recipient, which is what the collection stores on chain. */
export function royaltiesToBps(split: RoyaltySplit): Record<string, number> {
    const { shares } = encodeRoyalties(split);
    // decimals 4 means the share is already in basis points.
    return shares;
}

/** What a recipient actually receives on a sale, for the deploy preview. */
export function royaltyPreview(
    split: RoyaltySplit,
): { address: string; percentOfSale: number }[] {
    const { shares } = encodeRoyalties(split);
    return Object.entries(shares).map(([address, share]) => ({
        address,
        percentOfSale: (share / SCALE) * 100,
    }));
}

export interface PendingDocInput {
    collectionName: string;
    description?: string;
    artist: string;
    placeholderImageUri: string;
    split: RoyaltySplit;
}

export function buildPendingDocument(input: PendingDocInput) {
    return {
        name: `${input.collectionName}`,
        description:
            input.description ||
            "This piece is awaiting its render. It is owned and tradeable now.",
        decimals: 0,
        isBooleanAmount: false,
        shouldPreferSymbol: false,
        creators: [input.artist],
        displayUri: input.placeholderImageUri,
        thumbnailUri: input.placeholderImageUri,
        royalties: encodeRoyalties(input.split),
    };
}

export interface PieceDocInput extends Omit<PendingDocInput, "split" | "placeholderImageUri"> {
    tokenId: number;
    /**
     * Already encoded, `{ decimals, shares }`.
     *
     * The chain is the authority: a collection stores its royalties as basis
     * points, and TZIP-21 with `decimals: 4` is the same unit, so a provider
     * publishes what the contract holds rather than reconstructing a split it
     * would have to guess at.
     */
    royalties: { decimals: number; shares: Record<string, number> };
    /** The generator, with the seed and parameters applied. */
    artifactUri: string;
    imageUri: string;
    seed: string;
    params?: Record<string, unknown>;
    codeHash: string;
}

/**
 * The document a provider publishes for one piece.
 *
 * The only builder. A provider used to assemble its own inline, which drifted:
 * it published a bare "#4" for a name, and no royalties at all, so nothing was
 * paid on any secondary sale. There is one of these now and it is tested.
 */
export function buildPieceDocument(input: PieceDocInput) {
    return {
        // Token ids are 0-based and displayed edition numbers are 1-based.
        name: `${input.collectionName} #${input.tokenId + 1}`,
        description: input.description || "",
        decimals: 0,
        isBooleanAmount: false,
        shouldPreferSymbol: false,
        creators: [input.artist],
        artifactUri: input.artifactUri,
        displayUri: input.imageUri,
        thumbnailUri: input.imageUri,
        royalties: input.royalties,
        aleaSeed: input.seed,
        aleaCodeHash: input.codeHash,
        aleaParams: input.params ? JSON.stringify(input.params) : "",
        attributes: input.params
            ? Object.entries(input.params).map(([name, value]) => ({
                  name,
                  value: String(value),
              }))
            : [],
    };
}
