import type { Metadata } from "next";
import Link from "next/link";
import { fetchMarketFeed, type ListingSort } from "@/lib/market";
import { ListingCard } from "@/components/feed/ListingCard";
import { AutoGrid } from "@/components/feed/AutoGrid";
import { Pager } from "@/components/feed/Pager";
import { addresses } from "@/lib/router";
import { formatTez } from "@/lib/utils";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";
import { ReadFailed } from "@/components/ReadFailed";

const PER_PAGE = 48;

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

type Query = { page?: string; sort?: string; generator?: string };

export default async function MarketPage({ searchParams }: { searchParams: Promise<Query> }) {
    let rawPage: string | undefined;
    let rawSort: string | undefined;
    let generator: string | undefined;

    try {
        const query = await searchParams;
        rawPage = query.page;
        rawSort = query.sort;
        generator = query.generator;
    } catch {
        return <ReadFailed />;
    }

    const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
    const sort: ListingSort = rawSort === "price" ? "price" : "recent";

    let data;
    try {
        data = await fetchMarketFeed({
            sort,
            generator,
            page,
            perPage: PER_PAGE,
        });
    } catch {
        return <ReadFailed />;
    }

    const { marketplace, listings, total, floorMutez, pieces, names, artists } = data;

    const scopedName = generator ? (names.get(generator) ?? generator) : undefined;
    const href = (over: Partial<Query>) => {
        const q = new URLSearchParams();
        const next = { page: rawPage, sort: rawSort, generator, ...over };
        if (next.generator) q.set("generator", next.generator);
        if (next.sort === "price") q.set("sort", "price");
        if (next.page && next.page !== "1") q.set("page", next.page);
        const s = q.toString();
        return s ? `/market?${s}` : "/market";
    };

    const first = (page - 1) * PER_PAGE + 1;
    const hasMore = page * PER_PAGE < total;

    return (
        <LastGood>
            <div className="mx-auto max-w-7xl px-4 py-8">
                <LiveRefresh seconds={15} />
                <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <h1 className="text-xl font-semibold tracking-tight">Market</h1>
                    <p className="text-sm text-muted-foreground">
                        {total > 0 && floorMutez !== null
                            ? `${total} for sale${scopedName ? ` from ${scopedName}` : ""}, from ${formatTez(floorMutez)} ꜩ`
                            : "2.5% of each sale, royalties paid from the generator"}
                    </p>
                </div>

                {(total > 1 || generator) && (
                    <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
                        {total > 1 && (
                            <>
                                <span className="text-muted-foreground">Sort</span>
                                <SortLink
                                    href={href({ sort: undefined, page: "1" })}
                                    active={sort === "recent"}
                                >
                                    Newest
                                </SortLink>
                                <SortLink
                                    href={href({ sort: "price", page: "1" })}
                                    active={sort === "price"}
                                >
                                    Lowest price
                                </SortLink>
                            </>
                        )}
                        {generator && (
                            <Link
                                href={href({ generator: undefined, page: "1" })}
                                className="text-muted-foreground underline hover:text-foreground"
                            >
                                See everything for sale
                            </Link>
                        )}
                    </div>
                )}

                {listings.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                        <h2 className="text-base font-medium">Nothing listed</h2>
                        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                            {!marketplace
                                ? "The marketplace is waiting to be deployed."
                                : generator
                                  ? "Nothing from this generator is for sale right now."
                                  : "Pieces listed for sale show up here."}
                        </p>
                        {generator ? (
                            <Link
                                href="/market"
                                className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                            >
                                See everything for sale
                            </Link>
                        ) : page > 1 ? (
                            <Link
                                href={href({ page: String(page - 1) })}
                                className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                            >
                                Back a page
                            </Link>
                        ) : null}
                    </div>
                ) : (
                    <>
                        <AutoGrid className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                            {listings.map((l, i) => (
                                <ListingCard
                                    // Ids are per marketplace, and listings from all of
                                    // them are merged here, so two can both be id 1.
                                    key={`${l.marketplace}:${l.id}`}
                                    listing={l}
                                    piece={pieces.get(`${l.generator}:${l.tokenId}`)}
                                    artist={artists.get(l.generator)}
                                    priority={i < 4}
                                />
                            ))}
                        </AutoGrid>
                        <Pager
                            page={page}
                            hasMore={hasMore}
                            href={(p) => href({ page: String(p) })}
                            showing={`${first}–${first + listings.length - 1} of ${total}`}
                        />
                    </>
                )}
            </div>
        </LastGood>
    );
}

function SortLink({
    href,
    active,
    children,
}: {
    href: string;
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            aria-current={active ? "true" : undefined}
            className={`rounded-full border px-3 py-1 transition-colors ${
                active
                    ? "border-foreground/30 bg-accent font-medium text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            }`}
        >
            {children}
        </Link>
    );
}
