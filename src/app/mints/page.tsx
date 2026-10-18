import { fetchLiveMints } from "@/lib/feed";
import { fetchActivePriceMap } from "@/lib/market";
import { PieceFeed } from "@/components/feed/PieceFeed";
import type { PieceSortKey } from "@/components/feed/PieceSortFilter";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";
import { ReadFailed } from "@/components/ReadFailed";
import type { Metadata } from "next";
import { BRAND } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Mints",
    description: `The newest pieces minted across every generator on ${BRAND.name}.`,
    alternates: { canonical: "/mints" },
    openGraph: {
        type: "website",
        url: `${BRAND.url}/mints`,
        title: "Mints",
        description: `The newest pieces minted across every generator on ${BRAND.name}.`,
    },
};

type Query = {
    generator?: string;
    sort?: PieceSortKey;
    forSale?: string;
};

export default async function MintsPage({ searchParams }: { searchParams: Promise<Query> }) {
    const { generator, sort, forSale } = await searchParams;

    const [liveMints, pricesMap] = await Promise.all([
        fetchLiveMints().catch(() => null),
        fetchActivePriceMap().catch(() => new Map<string, bigint>()),
    ]);

    if (!liveMints) {
        return (
            <LastGood failed fallback={<ReadFailed />}>
                <div className="mx-auto max-w-7xl px-4 py-8">
                    <LiveRefresh seconds={5} />
                    <EmptyFeed reason="unreachable" />
                </div>
            </LastGood>
        );
    }

    if (liveMints.pieces.length === 0 && liveMints.generators.length === 0) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-8">
                <EmptyFeed reason="no-generators" />
            </div>
        );
    }

    const scoped = liveMints.generators.find((g) => g.address === generator);
    const initialPrices: [string, string][] = Array.from(pricesMap.entries()).map(([k, v]) => [
        k,
        v.toString(),
    ]);

    return (
        <LastGood>
            <div className="mx-auto max-w-7xl px-4 py-8">
                <LiveRefresh seconds={30} />

                <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <h1 className="text-xl font-semibold tracking-tight">Mints</h1>
                    <p className="text-sm text-muted-foreground">
                        {scoped
                            ? `Pieces from ${scoped.name}`
                            : "Newest pieces across every generator"}
                    </p>
                </div>

                {liveMints.pieces.length === 0 ? (
                    <EmptyFeed reason="no-pieces" />
                ) : (
                    <PieceFeed
                        initial={liveMints.pieces}
                        generators={liveMints.generators}
                        initialGenerator={generator}
                        initialPrices={initialPrices}
                        initialSort={sort}
                        initialForSaleOnly={forSale === "true" || forSale === "1"}
                        artists={liveMints.artists}
                    />
                )}
            </div>
        </LastGood>
    );
}
