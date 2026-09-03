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
    // The root title is a template, and a template applied to nothing gives a
    // page called "Aleatory ·". `absolute` is how the home page opts out.
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
    // An indexer that did not answer is a quiet front page, the way it is a
    // quiet market page. This is the first thing anybody sees, and throwing
    // here takes the whole route to the error screen over a read that will
    // work again in fifteen seconds.
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
