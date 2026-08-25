import { Suspense } from "react";
import { fetchRecentFeed } from "@/lib/feed";
import { FeedGrid, FeedGridSkeleton } from "@/components/feed/FeedGrid";
import { EmptyFeed } from "@/components/feed/EmptyFeed";

// Chain state moves, and a feed that is a minute stale is fine. Anything
// longer and a fresh mint looks lost.
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
