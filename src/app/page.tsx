import { Suspense } from "react";
import { fetchRecentFeed } from "@/lib/feed";
import { FeedGrid, FeedGridSkeleton } from "@/components/feed/FeedGrid";
import { EmptyFeed } from "@/components/feed/EmptyFeed";

// A fresh mint should appear within about half a minute.
export const revalidate = 30;

async function Recent() {
    const feed = await fetchRecentFeed();

    if (feed.unconfigured) return <EmptyFeed reason="unconfigured" />;
    if (feed.collectionCount === 0) return <EmptyFeed reason="no-collections" />;
    if (feed.pieces.length === 0) return <EmptyFeed reason="no-pieces" />;

    return <FeedGrid pieces={feed.pieces} />;
}

export default function HomePage() {
    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-6 flex items-baseline justify-between">
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
