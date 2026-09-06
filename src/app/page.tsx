import { Suspense } from "react";
import { fetchRecentFeed } from "@/lib/feed";
import { FeedGrid, FeedGridSkeleton } from "@/components/feed/FeedGrid";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { LiveRefresh } from "@/components/LiveRefresh";
import { SiteJsonLd } from "@/components/JsonLd";
import type { Metadata } from "next";
import { BRAND } from "@/lib/config";

// A fresh mint should appear within about half a minute.
export const revalidate = 30;

export const metadata: Metadata = {
    // The root layout's title is a template; `absolute` opts the home page out of it.
    title: { absolute: `${BRAND.name} — ${BRAND.tagline}` },
    description: BRAND.description,
    alternates: { canonical: "/" },
    openGraph: {
        type: "website",
        url: BRAND.url,
        title: `${BRAND.name} — ${BRAND.tagline}`,
        description: BRAND.description,
    },
};

async function Recent() {
    // An indexer that doesn't answer shows an empty feed rather than the error screen;
    // the read typically works again within seconds.
    const feed = await fetchRecentFeed().catch(() => null);
    if (!feed) return <EmptyFeed reason="unreachable" />;

    if (feed.unconfigured) return <EmptyFeed reason="unconfigured" />;
    if (feed.collectionCount === 0) return <EmptyFeed reason="no-collections" />;
    if (feed.pieces.length === 0) return <EmptyFeed reason="no-pieces" />;

    return <FeedGrid pieces={feed.pieces} />;
}

export default function HomePage() {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <LiveRefresh seconds={30} />
            <SiteJsonLd />
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h1 className="text-xl font-semibold tracking-tight">Recent</h1>
                <p className="text-sm text-muted-foreground">
                    Newest pieces across every collection
                </p>
            </div>

            <Suspense fallback={<FeedGridSkeleton />}>
                <Recent />
            </Suspense>
        </div>
    );
}
