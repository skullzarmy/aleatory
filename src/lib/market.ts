/**
 * Marketplace state, read from the contract's storage through TzKT.
 */
import { CONTRACTS, tzktApi } from "./config";

export interface Listing {
    id: number;
    seller: string;
    collection: string;
    tokenId: string;
    priceMutez: number;
    feeBps: number;
}

export interface Offer {
    id: number;
    buyer: string;
    collection: string;
    tokenId: string;
    amountMutez: number;
}

interface BigMapRow<V> {
    key: string;
    value: V;
    active: boolean;
}

async function bigmap<V>(path: string, params: Record<string, string | number>): Promise<BigMapRow<V>[]> {
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

function toListing(r: BigMapRow<RawListing>): Listing {
    return {
        id: parseInt(r.key, 10),
        seller: r.value.seller,
        collection: r.value.collection,
        tokenId: r.value.token_id,
        priceMutez: parseInt(r.value.price, 10),
        feeBps: parseInt(r.value.fee_bps, 10),
    };
}

function toOffer(r: BigMapRow<RawOffer>): Offer {
    return {
        id: parseInt(r.key, 10),
        buyer: r.value.buyer,
        collection: r.value.collection,
        tokenId: r.value.token_id,
        amountMutez: parseInt(r.value.amount, 10),
    };
}

async function bigmapPath(name: string): Promise<string | null> {
    if (!CONTRACTS.marketplace) return null;
    return `/v1/contracts/${CONTRACTS.marketplace}/bigmaps/${name}/keys`;
}

export async function fetchListings(limit = 48): Promise<Listing[]> {
    const path = await bigmapPath("listings");
    if (!path) return [];
    const rows = await bigmap<RawListing>(path, { active: "true", "sort.desc": "id", limit });
    return rows.map(toListing);
}

/** The live listing for one token, when there is one. */
export async function fetchListingFor(
    collection: string,
    tokenId: string,
): Promise<Listing | null> {
    const path = await bigmapPath("listings");
    if (!path) return null;
    const rows = await bigmap<RawListing>(path, {
        active: "true",
        "value.collection": collection,
        "value.token_id": tokenId,
        limit: 1,
    });
    return rows[0] ? toListing(rows[0]) : null;
}

export async function fetchOffersFor(
    collection: string,
    tokenId: string,
): Promise<Offer[]> {
    const path = await bigmapPath("offers");
    if (!path) return [];
    const rows = await bigmap<RawOffer>(path, {
        active: "true",
        "value.collection": collection,
        "value.token_id": tokenId,
        "sort.desc": "id",
        limit: 20,
    });
    return rows.map(toOffer);
}

/** What a seller nets after the platform fee and royalties. */
export function proceeds(
    priceMutez: number,
    feeBps: number,
    royaltyBps: number,
): { fee: number; royalties: number; seller: number } {
    const fee = Math.floor((priceMutez * feeBps) / 10000);
    const capped = Math.min(royaltyBps, 2500);
    const royalties = Math.floor((priceMutez * capped) / 10000);
    return { fee, royalties, seller: priceMutez - fee - royalties };
}
