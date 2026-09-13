import Link from "next/link";
import { fetchRecentFeed } from "@/lib/feed";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { Pager } from "@/components/feed/Pager";
import { LiveRefresh } from "@/components/LiveRefresh";
import type { Metadata } from "next";
import { BRAND } from "@/lib/config";

const PER_PAGE = 48;

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

type Query = { page?: string; generator?: string };

export default async function MintsPage({ searchParams }: { searchParams: Promise<Query> }) {
    const { page: rawPage, generator } = await searchParams;
    const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

    const feed = await fetchRecentFeed(PER_PAGE, (page - 1) * PER_PAGE, generator).catch(
        () => null,
    );
    if (!feed) {
        return (
            <Shell>
                <EmptyFeed reason="unreachable" />
            </Shell>
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
    const href = (p: number) => {
        const q = new URLSearchParams();
        if (generator) q.set("generator", generator);
        if (p > 1) q.set("page", String(p));
        const s = q.toString();
        return s ? `/mints?${s}` : "/mints";
    };

    const first = (page - 1) * PER_PAGE + 1;

    return (
        <Shell
            scope={scoped?.name}
            generators={feed.generators}
            selected={generator}
            total={feed.mintingGeneratorCount}
        >
            <LiveRefresh seconds={30} />

            {feed.pieces.length === 0 ? (
                <>
                    <EmptyFeed reason={page > 1 ? "past-the-end" : "no-pieces"} />
                    <Pager page={page} hasMore={false} href={href} showing="" />
                </>
            ) : (
                <>
                    <FeedGrid pieces={feed.pieces} />
                    <Pager
                        page={page}
                        hasMore={feed.hasMore}
                        href={href}
                        showing={`${first}–${first + feed.pieces.length - 1}`}
                    />
                </>
            )}
        </Shell>
    );
}

function Shell({
    children,
    scope,
    generators,
    selected,
    total,
}: {
    children: React.ReactNode;
    scope?: string;
    generators?: { address: string; name: string }[];
    selected?: string;
    total?: number;
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
                />
            )}

            {children}
        </div>
    );
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
}: {
    generators: { address: string; name: string }[];
    selected?: string;
    hidden: number;
}) {
    return (
        <div className="mb-6 flex flex-wrap items-center gap-2">
            <Chip href="/mints" active={!selected}>
                All
            </Chip>
            {generators.map((g) => (
                <Chip
                    key={g.address}
                    href={`/mints?generator=${g.address}`}
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
