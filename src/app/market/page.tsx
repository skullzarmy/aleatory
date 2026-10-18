import type { Metadata } from "next";
import { fetchLiveMarket } from "@/lib/market";
import { MarketFeed } from "@/components/feed/MarketFeed";
import type { MarketSortKey } from "@/components/feed/MarketSortFilter";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";
import { ReadFailed } from "@/components/ReadFailed";

export const metadata: Metadata = {
    title: "Market",
    alternates: { canonical: "/market" },
    openGraph: {
        type: "website",
        title: "Market",
        description: "Pieces listed for sale, with royalties paid from the generator.",
    },
};

export const dynamic = "force-dynamic";

type Query = { sort?: string; generator?: string };

export default async function MarketPage({ searchParams }: { searchParams: Promise<Query> }) {
    let rawSort: string | undefined;
    let generator: string | undefined;

    try {
        const query = await searchParams;
        rawSort = query.sort;
        generator = query.generator;
    } catch {
        return <ReadFailed />;
    }

    let initialSort: MarketSortKey = "recent";
    if (rawSort === "price" || rawSort === "price-asc") initialSort = "price-asc";
    else if (rawSort === "price-desc") initialSort = "price-desc";
    else if (rawSort === "oldest") initialSort = "oldest";

    let data;
    try {
        data = await fetchLiveMarket();
    } catch {
        return <ReadFailed />;
    }

    const { marketplace, listings, pieces, generators, artists, names } = data;

    return (
        <LastGood>
            <div className="mx-auto max-w-7xl px-4 py-8">
                <LiveRefresh seconds={15} />
                <MarketFeed
                    initialListings={listings}
                    initialPieces={pieces}
                    generators={generators}
                    artists={artists}
                    names={names}
                    initialGenerator={generator}
                    initialSort={initialSort}
                    marketplace={marketplace}
                />
            </div>
        </LastGood>
    );
}
