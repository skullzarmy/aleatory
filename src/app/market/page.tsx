import type { Metadata } from "next";
import { fetchListings } from "@/lib/market";
import { fetchAllCollections } from "@/lib/collection";
import { piecesFor } from "@/lib/feed";
import { ListingCard } from "@/components/feed/ListingCard";
import { addresses } from "@/lib/router";
import { formatTez } from "@/lib/utils";
import { LiveRefresh } from "@/components/LiveRefresh";

export const metadata: Metadata = { title: "Market" };
export const revalidate = 15;

/**
 * Everything for sale.
 *
 * A listing carries a collection, a token id and a price, and nothing else, so
 * this page used to be rows of numbers: it asked people to decide whether they
 * wanted an artwork without showing it to them. The images and names are a
 * second read, done here in two queries for the whole page rather than one per
 * row.
 */
export default async function MarketPage() {
    const [marketplace, listings] = await Promise.all([
        addresses().then((a) => a.marketplace),
        fetchListings().catch(() => []),
    ]);

    // Collection names first, so a card can say "Drift" rather than a KT1.
    // TzKT's own alias is null for every contract we deploy, so the name comes
    // from the collection's metadata.
    const collections = await fetchAllCollections().catch(() => []);
    const names = new Map(
        collections.flatMap((c) => (c.name ? [[c.address, c.name] as const] : [])),
    );
    const pieces = await piecesFor(listings, names).catch(() => new Map());

    const cheapest = listings.reduce(
        (low, l) => (low === null || l.priceMutez < low ? l.priceMutez : low),
        null as bigint | null,
    );

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <LiveRefresh seconds={15} />
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h1 className="text-xl font-semibold tracking-tight">Market</h1>
                <p className="text-sm text-muted-foreground">
                    {listings.length > 0 && cheapest !== null
                        ? `${listings.length} for sale, from ${formatTez(cheapest)} ꜩ`
                        : "2.5% of each sale, royalties paid from the collection"}
                </p>
            </div>

            {listings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                    <h2 className="text-base font-medium">Nothing listed</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                        {marketplace
                            ? "Pieces listed for sale show up here."
                            : "The marketplace is waiting to be deployed."}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {listings.map((l) => (
                        <ListingCard
                            key={l.id}
                            listing={l}
                            piece={pieces.get(`${l.collection}:${l.tokenId}`)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
