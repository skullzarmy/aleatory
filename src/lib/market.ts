/** Marketplace state, read from the contract's storage through TzKT. */
import { CONTRACTS, tzktApi } from "./config";
import { isBlockedGenerator } from "./blocklist";
import { addresses } from "./router";
import { fetchHeldAmong, indexerFetch } from "./tzkt";

export interface Listing {
    id: number;
    /**
     * The marketplace holding it, which is not always the current one. Buying,
     * delisting and cancelling all have to go to this address.
     */
    marketplace: string;
    seller: string;
    generator: string;
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
    generator: string;
    tokenId: string;
    amountMutez: bigint;
    /**
     * The platform fee this offer was made under, snapshotted when it was
     * placed. `set_fee` is never retroactive.
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
    const res = await indexerFetch(url.toString(), { next: { revalidate: 15 } } as RequestInit);
    if (!res.ok) return [];
    return (await res.json()) as BigMapRow<V>[];
}

// The marketplace's own storage shape. Its field is `collection`, so that name
// stays here and is mapped to ours on the way in.
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
        generator: r.value.collection,
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
        generator: r.value.collection,
        tokenId: r.value.token_id,
        amountMutez: BigInt(r.value.amount),
        feeBps: parseInt(r.value.fee_bps, 10),
    };
}

const bigmapPath = (marketplace: string, name: string) =>
    `/v1/contracts/${marketplace}/bigmaps/${name}/keys`;

/**
 * Ask every marketplace, in parallel. A listing lives in whichever contract it
 * was made on, and that contract keeps working after a newer one ships. One
 * slow or missing marketplace returns nothing and the rest still answer.
 */
async function acrossMarketplaces<T>(read: (marketplace: string) => Promise<T[]>): Promise<T[]> {
    const { marketplaces } = await addresses();
    if (marketplaces.length === 0) return [];
    const results = await Promise.all(marketplaces.map((m) => read(m).catch(() => [] as T[])));
    return results.flat();
}

export type ListingSort = "recent" | "price";

export interface ListingPage {
    listings: Listing[];
    /** Live listings matching the scope, before the page is cut. */
    total: number;
    /** The lowest price in scope, which is not always on this page. */
    floorMutez: bigint | null;
}

/**
 * Ordering and paging happen here rather than in the query: ids are per
 * marketplace, so neither price nor recency can be asked of three bigmaps
 * separately and merged.
 */
export async function fetchListingPage(
    options: { sort?: ListingSort; generator?: string; limit?: number; offset?: number } = {},
): Promise<ListingPage> {
    const { sort = "recent", generator, limit = 48, offset = 0 } = options;

    const all = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawListing>(bigmapPath(m, "listings"), {
            active: "true",
            "sort.desc": "id",
            limit: 500,
        });
        return rows.map((r) => toListing(r, m));
    });

    const scoped = all
        .filter((l) => !isBlockedGenerator(l.generator))
        .filter((l) => !generator || l.generator === generator);

    const ordered = [...scoped].sort((a, b) =>
        sort === "price" ? Number(a.priceMutez - b.priceMutez) : b.id - a.id,
    );

    return {
        listings: ordered.slice(offset, offset + limit),
        total: scoped.length,
        floorMutez: scoped.reduce<bigint | null>(
            (low, l) => (low === null || l.priceMutez < low ? l.priceMutez : low),
            null,
        ),
    };
}

export async function fetchListings(limit = 48): Promise<Listing[]> {
    return (await fetchListingPage({ limit })).listings;
}

/** The live listing for one token, wherever it lives. */
export async function fetchListingFor(generator: string, tokenId: string): Promise<Listing | null> {
    if (isBlockedGenerator(generator)) return null;
    const found = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawListing>(bigmapPath(m, "listings"), {
            active: "true",
            "value.collection": generator,
            "value.token_id": tokenId,
            limit: 1,
        });
        return rows.map((r) => toListing(r, m));
    });
    // A token can only be escrowed by one marketplace at a time, since listing
    // transfers it. More than one means something is wrong; take the newest.
    return found.sort((a, b) => b.id - a.id)[0] ?? null;
}

export async function fetchOffersFor(generator: string, tokenId: string): Promise<Offer[]> {
    const all = await acrossMarketplaces(async (m) => {
        const rows = await bigmap<RawOffer>(bigmapPath(m, "offers"), {
            active: "true",
            "value.collection": generator,
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
    return all.filter((l) => !isBlockedGenerator(l.generator)).sort((a, b) => b.id - a.id);
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
        .filter((o) => !isBlockedGenerator(o.generator))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
}

/** An offer somebody made on a piece this account is holding or selling. */
export interface IncomingOffer extends Offer {
    /**
     * The listing escrowing this piece, when it is for sale. `accept_offer`
     * transfers from the sender, so the listing has to come down first, and
     * both ids and both marketplaces are carried so the two go in one
     * operation.
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
 * Both sides of the offer book, for one account. Ownership is not in the offers
 * big map, so the book is read first and narrowed against the account second:
 * two requests when nothing is standing, four when something is.
 *
 * Pieces this account has listed count as theirs, because listing escrows the
 * token into the marketplace and a seller stops holding it the moment they
 * list.
 *
 * The cap is on the whole book. Past two hundred standing offers this reads the
 * newest and the oldest offer on somebody's piece stops being counted, which is
 * the signal to page it properly.
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
    const listed = new Map(listings.map((l) => [`${l.generator}:${l.tokenId}`, l]));

    const incoming = candidates.flatMap((o): IncomingOffer[] => {
        const key = `${o.generator}:${o.tokenId}`;
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
 * What a seller nets after the platform fee and royalties. The arithmetic
 * matches the contract's: floor at each step, royalties clamped at 25%.
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
