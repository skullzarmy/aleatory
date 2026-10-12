"use client";

import { useCallback } from "react";
import { InfiniteScroll } from "./InfiniteScroll";
import { FeedGrid } from "./FeedGrid";
import { morePieces } from "@/app/feed-actions";
import type { FeedPiece } from "@/lib/feed";

/**
 * Minted pieces, continuing as they are scrolled.
 *
 * Each page carries the creators of the generators it mentions, and they
 * accumulate: a piece loaded on page three needs its generator's artists, and
 * that generator may first appear on page three.
 */
export function PieceFeed({
    initial,
    cursor,
    artists,
    generator,
}: {
    initial: FeedPiece[];
    cursor?: string;
    /** Entries, because a Map does not survive the server boundary. */
    artists: [string, string[]][];
    /** Narrowed to one generator, when the page is. */
    generator?: string;
}) {
    // Held outside React state: the grid re-renders from `items`, and this is
    // a lookup those items read, so a page that arrives with new creators has
    // them in hand by the time the cards render.
    const known = new Map(artists);

    const load = useCallback(
        async (at: string) => {
            const next = await morePieces(at, generator);
            for (const [address, creators] of next.artists) known.set(address, creators);
            return { items: next.items, cursor: next.cursor };
        },
        [generator, known],
    );

    return (
        <InfiniteScroll initial={initial} initialCursor={cursor} load={load} label="pieces">
            {(pieces) => <FeedGrid pieces={pieces} artists={known} />}
        </InfiniteScroll>
    );
}
