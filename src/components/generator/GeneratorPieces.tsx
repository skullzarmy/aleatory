"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FeedGrid } from "@/components/feed/FeedGrid";
import type { FeedPiece } from "@/lib/feed";

const PAGE_SIZE = 24;

export function GeneratorPieces({
    pieces: initialPieces,
    artists = [],
    prices = [],
}: {
    pieces: FeedPiece[];
    artists?: [string, string[]][];
    prices?: [string, string][];
}) {
    const [pieces, setPieces] = useState<FeedPiece[]>(initialPieces);
    const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setPieces(initialPieces);
    }, [initialPieces]);

    const knownArtists = useMemo(() => new Map(artists), [artists]);
    const pricesMap = useMemo(() => new Map(prices.map(([k, v]) => [k, BigInt(v)])), [prices]);

    const visiblePieces = useMemo(() => pieces.slice(0, visibleCount), [pieces, visibleCount]);

    const hasMore = visibleCount < pieces.length;

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, pieces.length));
                }
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, pieces.length]);

    return (
        <div>
            <FeedGrid pieces={visiblePieces} artists={knownArtists} prices={pricesMap} />

            {hasMore && (
                <div ref={sentinelRef} className="py-8 text-center text-sm text-muted-foreground">
                    <span>Loading more</span>
                </div>
            )}

            {!hasMore && pieces.length > 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                    {pieces.length} {pieces.length === 1 ? "piece" : "pieces"}, which is all of them
                </p>
            )}
        </div>
    );
}
