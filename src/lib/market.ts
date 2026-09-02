/**
 * Marketplace state, read from the contract's storage through TzKT.
 */
import { CONTRACTS, tzktApi } from "./config";
import { isBlockedCollection } from "./blocklist";
import { addresses } from "./router";

export interface Listing {
    id: number;
    /**
     * The marketplace holding it.
     *
     * Carried on the row because buying, delisting and cancelling have to go
     * to the contract that holds the listing, which is not always the current
     * one. Sending a delist to the wrong marketplace fails, and sending a buy
     * to the wrong one fails after the wallet has already asked.
     */
    marketplace: string;
    seller: string;
    collection: string;
    tokenId: string;
    /** Mutez. Chain amounts are arbitrary precision, so they stay bigint. */
    priceMutez: bigint;
    feeBps: number;
}

export interface Offer {
    id: number;
    /** The marketplace holding the escrowed tez. See Listing. */
    marketplace: string;
    buyer: string;
    collection: string;
    tokenId: string;
    amountMutez: bigint;
}

interface BigMapRow<V> {
    key: string;
    value: V;
    active: boolean;
}

async function bigmap<V>(
    path: string,
    params: Record<string, string | number>,
): Promise<BigMapRow<V>[]> {
    const url = new URL(`${tzktApi()}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { next: { revalidate: 15 } });
    if (!res.ok) return [];
    return (await res.json()) as BigMapRow<V>[];
}

type RawListing = {
    seller: string;
    collection: string;
    token_id: string;
    price: string;
    fee_bps: string;
};

type RawOffer = {
    buyer: string;
    collection: string;
    token_id: string;
    amount: string;
    fee_bps: string;
};

function toListing(r: BigMapRow<RawListing>, marketplace: string): Listing {
    return {
        id: parseInt(r.key, 10),
        marketplace,
        seller: r.value.seller,
        collection: r.value.collection,
        tokenId: r.value.token_id,
        priceMutez: BigInt(r.value.price),
        feeBps: parseInt(r.value.fee_bps, 10),
    };
}

function toOffer(r: BigMapRow<RawOffer>, marketplace: string): Offer {
    return {
        marketplace,
        id: parseInt(r.key, 10),
        buyer: r.value.buyer,
        collection: r.value.collection,
        tokenId: r.value.token_id,
        amountMutez: BigInt(r.value.amount),
    };
}

const bigmapPath = (marketplace: string, name: string) =>
    `/v1/contracts/${marketplace}/bigmaps/${name}/keys`;

/**
 * Ask every marketplace, in parallel.
 *
 * A listing lives in whichever contract it was made on, and that contract
 * keeps working after a newer one ships. Reading only the current address
 * would hide live listings and escrowed offers from the people who own them.
 * One slow or missing marketplace returns nothing and the rest still answer.
 */
async function acrossMarketplaces<T>(read: (marketplace: string) => Promise<T[]>): Promise<T[]> {
    const { marketplaces } = await addresses();
    if (marketplaces.length === 0) return [];
    const results = await Promise.all(marketplaces.map((m) => read(m).catch(() => [] as T[])));
    return results.flat();
}

export async function fetchListings(limit = 48): Promise<Listing[]> {
    const all = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawListing>(bigmapPath(m, "listings"), {
            active: "true",
            "sort.desc": "id",
            limit,
        });
        return rows.map((r) => toListing(r, m));
    });
    // Newest first across all of them, then trimmed, so a retired marketplace
    // with old ids cannot crowd out the current one.
    return all
        .filter((l) => !isBlockedCollection(l.collection))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
}

/** The live listing for one token, wherever it lives. */
export async function fetchListingFor(
    collection: string,
    tokenId: string,
): Promise<Listing | null> {
    if (isBlockedCollection(collection)) return null;
    const found = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawListing>(bigmapPath(m, "listings"), {
            active: "true",
            "value.collection": collection,
            "value.token_id": tokenId,
            limit: 1,
        });
        return rows.map((r) => toListing(r, m));
    });
    // A token can only be escrowed by one marketplace at a time, since listing
    // transfers it. More than one means something is wrong; take the newest.
    return found.sort((a, b) => b.id - a.id)[0] ?? null;
}

export async function fetchOffersFor(collection: string, tokenId: string): Promise<Offer[]> {
    const all = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawOffer>(bigmapPath(m, "offers"), {
            active: "true",
            "value.collection": collection,
            "value.token_id": tokenId,
            "sort.desc": "id",
            limit: 20,
        });
        return rows.map((r) => toOffer(r, m));
    });
    return all.sort((a, b) => Number(b.amountMutez - a.amountMutez));
}

/**
 * What a seller nets after the platform fee and royalties.
 *
 * The arithmetic matches the contract's: floor at each step, and the royalty
 * total clamped at 25% the way the marketplace clamps it.
 */
export function proceeds(
    priceMutez: bigint,
    feeBps: number,
    royaltyBps: number,
): { fee: bigint; royalties: bigint; seller: bigint } {
    const fee = (priceMutez * BigInt(feeBps)) / 10000n;
    const capped = BigInt(Math.min(royaltyBps, 2500));
    const royalties = (priceMutez * capped) / 10000n;
    return { fee, royalties, seller: priceMutez - fee - royalties };
}
