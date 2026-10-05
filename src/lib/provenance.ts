/**
 * One piece's history: minted, listed, cancelled, sold, transferred. Built
 * from two chain sources and merged into one timeline, oldest first as read,
 * reversed for display.
 *
 * `/v1/tokens/transfers` gives every FA2 transfer, including the mint (the
 * one with no `from`) and the two transfers a listing causes (escrow in on
 * `list`, escrow out on `sale` or `delist`). Market events say what a
 * marketplace-bound transfer actually was; a plain transfer neither to nor
 * from a marketplace is a real wallet-to-wallet move and gets its own entry.
 */
import { tzktApi } from "./config";
import { indexerFetch } from "./tzkt";
import { addresses } from "./router";

export interface ProvenanceEvent {
    id: number;
    at: string;
    kind: "minted" | "listed" | "cancelled" | "sold" | "transferred";
    /** `transferred` and `sold`: who it moved from. */
    from?: string;
    /** `minted`, `transferred` and `sold`: who it moved to. */
    to?: string;
    /** `listed` and `cancelled`: who made or ended the listing. */
    by?: string;
    /** `listed` and `sold`, mutez. */
    priceMutez?: bigint;
}

interface Transfer {
    id: number;
    timestamp: string;
    from?: { address: string };
    to?: { address: string };
}

interface MarketPayload {
    listing_id?: string;
    collection?: string;
    token_id?: string;
    seller?: string;
    buyer?: string;
    price?: string;
}

interface EventRow {
    id: number;
    timestamp: string;
    contract: { address: string };
    tag: string;
    payload: MarketPayload | string;
}

/** `delist`'s payload is the bare listing id when its record has one field; everything else carries it under `listing_id`. */
function listingIdOf(payload: MarketPayload | string): string {
    if (typeof payload === "string") return payload;
    return payload.listing_id ?? "";
}

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const url = new URL(`${tzktApi()}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await indexerFetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) throw new Error(`TzKT ${res.status} on ${path}`);
    return (await res.json()) as T;
}

export async function fetchProvenance(
    contract: string,
    tokenId: string,
): Promise<ProvenanceEvent[]> {
    const { marketplaces } = await addresses();
    const marketSet = new Set(marketplaces);

    const [transfers, events] = await Promise.all([
        get<Transfer[]>("/v1/tokens/transfers", {
            "token.contract": contract,
            "token.tokenId": tokenId,
            "sort.asc": "id",
            limit: 200,
        }).catch(() => []),
        marketplaces.length === 0
            ? Promise.resolve([])
            : get<EventRow[]>("/v1/contracts/events", {
                  "contract.in": marketplaces.join(","),
                  "tag.in": "list,delist,sale",
                  "sort.asc": "id",
                  limit: 200,
              })
                  .then((rows) =>
                      rows.filter((r) => {
                          const p = r.payload;
                          if (typeof p === "string") return true; // delist, matched by listing id below
                          return p.collection === contract && p.token_id === tokenId;
                      }),
                  )
                  .catch(() => []),
    ]);

    // Resolve which delist rows are actually about this token: a bare payload
    // names no collection, so it is matched by listing id against a `list` row
    // already known to be this token's.
    const thisTokenListingIds = new Set(
        events
            .filter((r) => r.tag === "list")
            .map((r) => listingIdOf(r.payload))
            .filter(Boolean),
    );
    const relevant = events.filter((r) => {
        if (r.tag !== "delist") return true;
        return thisTokenListingIds.has(listingIdOf(r.payload));
    });

    // Each `list` row's own seller, by listing id, so a `delist` naming only
    // the id can still say who it was listed by.
    const sellerByListingId = new Map<string, string>();
    for (const r of relevant) {
        if (r.tag === "list" && typeof r.payload !== "string" && r.payload.seller) {
            sellerByListingId.set(listingIdOf(r.payload), r.payload.seller);
        }
    }

    // `accept_offer`'s sale never touches a marketplace address at all: the
    // holder transfers straight to the buyer in the same operation as the
    // `sale` event. Keyed by from/to/timestamp, so the matching raw transfer
    // below is recognised as that sale and not counted a second time as a
    // plain transfer.
    const saleTransferKeys = new Set(
        relevant
            .filter(
                (r): r is EventRow & { payload: MarketPayload } =>
                    r.tag === "sale" && typeof r.payload !== "string",
            )
            .map((r) => `${r.payload.seller}:${r.payload.buyer}:${r.timestamp}`),
    );

    const out: ProvenanceEvent[] = [];

    for (const r of relevant) {
        const p = r.payload;
        if (r.tag === "list" && typeof p !== "string") {
            out.push({
                id: r.id,
                at: r.timestamp,
                kind: "listed",
                by: p.seller,
                priceMutez: p.price !== undefined ? BigInt(p.price) : undefined,
            });
        } else if (r.tag === "delist") {
            // The seller isn't in delist's own payload; its listing id is,
            // matched against the `list` row that opened it.
            out.push({
                id: r.id,
                at: r.timestamp,
                kind: "cancelled",
                by: sellerByListingId.get(listingIdOf(p)),
            });
        } else if (r.tag === "sale" && typeof p !== "string") {
            out.push({
                id: r.id,
                at: r.timestamp,
                kind: "sold",
                from: p.seller,
                to: p.buyer,
                priceMutez: p.price !== undefined ? BigInt(p.price) : undefined,
            });
        }
    }

    for (const t of transfers) {
        if (!t.from) {
            out.push({ id: t.id, at: t.timestamp, kind: "minted", to: t.to?.address });
            continue;
        }
        const toMarket = t.to && marketSet.has(t.to.address);
        const fromMarket = marketSet.has(t.from.address);
        const key = `${t.from.address}:${t.to?.address}:${t.timestamp}`;
        // Escrow in and out of a marketplace, and an offer's direct
        // wallet-to-wallet payout, are all represented by the matching market
        // event instead, which carries the price and the counterparty.
        if (toMarket || fromMarket || saleTransferKeys.has(key)) continue;
        out.push({
            id: t.id,
            at: t.timestamp,
            kind: "transferred",
            from: t.from.address,
            to: t.to?.address,
        });
    }

    // Timestamp, not `id`: a transfer's id and an event's id are different,
    // incomparable TzKT id spaces, not one ordering.
    out.sort((a, b) => a.at.localeCompare(b.at));
    return out.reverse();
}
