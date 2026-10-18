import Link from "next/link";
import { fetchRecentFeed } from "@/lib/feed";
import { fetchActivePriceMap } from "@/lib/market";
import { PieceFeed } from "@/components/feed/PieceFeed";
import type { PieceSortKey } from "@/components/feed/PieceSortFilter";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";
import { ReadFailed } from "@/components/ReadFailed";
import type { Metadata } from "next";
import { BRAND } from "@/lib/config";

const PER_PAGE = 48;

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

    // The first page, server rendered. The rest arrive as it is scrolled.
    const [feed, pricesMap] = await Promise.all([
        fetchRecentFeed(PER_PAGE, 0, generator).catch(() => null),
        fetchActivePriceMap().catch(() => new Map<string, bigint>()),
    ]);
    if (!feed) {
        return (
            <LastGood failed fallback={<ReadFailed />}>
                <Shell>
                    <LiveRefresh seconds={5} />
                    <EmptyFeed reason="unreachable" />
                </Shell>
            </LastGood>
        );
    }
    if (feed.unconfigured) {
        return (
            <Shell>
                <EmptyFeed reason="unconfigured" />
            </Shell>
        );
    }
    if (feed.generatorCount === 0) {
        return (
            <Shell>
                <EmptyFeed reason="no-generators" />
            </Shell>
        );
    }

    const scoped = feed.generators.find((g) => g.address === generator);
    const initialPrices: [string, string][] = Array.from(pricesMap.entries()).map(([k, v]) => [
        k,
        v.toString(),
    ]);

    return (
        <LastGood>
            <Shell
                scope={scoped?.name}
                generators={feed.generators}
                selected={generator}
                total={feed.mintingGeneratorCount}
                sort={sort}
                forSale={forSale}
            >
                <LiveRefresh seconds={30} />

                {feed.pieces.length === 0 ? (
                    <EmptyFeed reason="no-pieces" />
                ) : (
                    <PieceFeed
                        key={generator ?? "all"}
                        initial={feed.pieces}
                        cursor={feed.hasMore ? String(feed.pieces.length) : undefined}
                        artists={Array.from(feed.artists.entries())}
                        generator={generator}
                        initialPrices={initialPrices}
                        initialSort={sort}
                        initialForSaleOnly={forSale === "true" || forSale === "1"}
                    />
                )}
            </Shell>
        </LastGood>
    );
}

function Shell({
    children,
    scope,
    generators,
    selected,
    total,
    sort,
    forSale,
}: {
    children: React.ReactNode;
    scope?: string;
    generators?: { address: string; name: string }[];
    selected?: string;
    total?: number;
    sort?: string;
    forSale?: string;
}) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h1 className="text-xl font-semibold tracking-tight">Mints</h1>
                <p className="text-sm text-muted-foreground">
                    {scope ? `Pieces from ${scope}` : "Newest pieces across every generator"}
                </p>
            </div>

            {generators && generators.length > 1 && (
                <GeneratorScope
                    generators={generators}
                    selected={selected}
                    hidden={(total ?? 0) - generators.length}
                    sort={sort}
                    forSale={forSale}
                />
            )}

            {children}
        </div>
    );
}

function buildMintsHref(generator?: string, sort?: string, forSale?: string) {
    const params = new URLSearchParams();
    if (generator) params.set("generator", generator);
    if (sort && sort !== "recent") params.set("sort", sort);
    if (forSale && (forSale === "true" || forSale === "1")) params.set("forSale", "true");
    const qs = params.toString();
    return qs ? `/mints?${qs}` : "/mints";
}

/**
 * Links rather than a select, so a scope is addressable and needs no script.
 * Only the generator is offered: every other trait belongs to one generator's
 * own vocabulary, so it cannot narrow a feed that spans all of them.
 */
function GeneratorScope({
    generators,
    selected,
    hidden,
    sort,
    forSale,
}: {
    generators: { address: string; name: string }[];
    selected?: string;
    hidden: number;
    sort?: string;
    forSale?: string;
}) {
    return (
        <div className="mb-6 flex flex-wrap items-center gap-2">
            <Chip href={buildMintsHref(undefined, sort, forSale)} active={!selected}>
                All
            </Chip>
            {generators.map((g) => (
                <Chip
                    key={g.address}
                    href={buildMintsHref(g.address, sort, forSale)}
                    active={selected === g.address}
                >
                    {g.name}
                </Chip>
            ))}
            {hidden > 0 && (
                <Link href="/" className="px-1 text-xs text-muted-foreground hover:text-foreground">
                    {hidden} more on the wall
                </Link>
            )}
        </div>
    );
}

function Chip({
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
            aria-current={active ? "page" : undefined}
            className={`max-w-[14rem] truncate rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                    ? "border-foreground/30 bg-accent font-medium text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            }`}
        >
            {children}
        </Link>
    );
}
