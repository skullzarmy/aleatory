/**
 * Marketplace state, read from the contract's storage through TzKT.
 */
import { CONTRACTS, tzktApi } from "./config";
import { isBlockedCollection } from "./blocklist";
import { addresses } from "./router";
import { fetchHeldAmong } from "./tzkt";

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
    /**
     * The platform fee this offer was made under.
     *
     * Snapshotted onto the record when the offer was placed, the way a
     * listing's is. `set_fee` is never retroactive, so what a seller receives
     * for accepting is worked out from this rather than from whatever the
     * marketplace charges today.
     */
    feeBps: number;
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
        feeBps: parseInt(r.value.fee_bps, 10),
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

/** Active listings made by one seller, wherever they live. */
export async function fetchListingsBy(seller: string): Promise<Listing[]> {
    const all = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawListing>(bigmapPath(m, "listings"), {
            active: "true",
            "value.seller": seller,
            "sort.desc": "id",
            limit: 200,
        });
        return rows.map((r) => toListing(r, m));
    });
    return all.filter((l) => !isBlockedCollection(l.collection)).sort((a, b) => b.id - a.id);
}

/** Every standing offer, newest first. Capped: see fetchAccountOffers. */
async function fetchAllOffers(limit = 200): Promise<Offer[]> {
    const all = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawOffer>(bigmapPath(m, "offers"), {
            active: "true",
            "sort.desc": "id",
            limit,
        });
        return rows.map((r) => toOffer(r, m));
    });
    return all
        .filter((o) => !isBlockedCollection(o.collection))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
}

/** An offer somebody made on a piece this account is holding or selling. */
export interface IncomingOffer extends Offer {
    /**
     * The listing escrowing this piece, when it is for sale.
     *
     * `accept_offer` transfers from the sender, and listing moves the token
     * into the marketplace, so the listing has to come down first. Both ids
     * are carried so the two go in one operation, and both marketplaces,
     * because a listing and an offer on the same piece can live in different
     * contracts.
     */
    listing: { id: number; marketplace: string } | null;
}

export interface AccountOffers {
    /** Offers on pieces this account holds or has listed, best first. */
    incoming: IncomingOffer[];
    /** Offers this account made, and the tez each one is escrowing. */
    outgoing: Offer[];
}

/**
 * Both sides of the offer book, for one account.
 *
 * Ownership is not in the offers big map, so there is no query that asks for
 * "offers on pieces I hold" directly. The book is read first and narrowed
 * against the account second, which is two requests when nothing is standing
 * and four when something is. That budget is what lets this run in the header
 * on every page.
 *
 * Pieces this account has *listed* count as theirs. Listing escrows the token
 * into the marketplace, so a seller stops holding a piece the moment they list
 * it, and reading holdings alone would hide every offer on everything for sale
 * from the person selling it.
 *
 * The cap is on the whole book rather than per account. At the point where
 * there are more than two hundred standing offers this reads the newest of them
 * and the oldest offer on somebody's piece stops being counted, which is the
 * signal to page this properly.
 */
export async function fetchAccountOffers(account: string): Promise<AccountOffers> {
    const offers = await fetchAllOffers();

    const outgoing = offers.filter((o) => o.buyer === account);
    const candidates = offers.filter((o) => o.buyer !== account);
    if (candidates.length === 0) return { incoming: [], outgoing };

    const [held, listings] = await Promise.all([
        fetchHeldAmong(account, candidates).catch(() => new Set<string>()),
        fetchListingsBy(account).catch(() => [] as Listing[]),
    ]);
    const listed = new Map(listings.map((l) => [`${l.collection}:${l.tokenId}`, l]));

    const incoming = candidates.flatMap((o): IncomingOffer[] => {
        const key = `${o.collection}:${o.tokenId}`;
        const listing = listed.get(key);
        if (!held.has(key) && !listing) return [];
        return [
            {
                ...o,
                listing: listing ? { id: listing.id, marketplace: listing.marketplace } : null,
            },
        ];
    });

    return {
        incoming: incoming.sort((a, b) => Number(b.amountMutez - a.amountMutez)),
        outgoing,
    };
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
