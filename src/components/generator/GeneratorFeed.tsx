"use client";

import { InfiniteScroll } from "@/components/feed/InfiniteScroll";
import { GeneratorGrid } from "./GeneratorCard";
import { moreGenerators } from "@/app/feed-actions";
import type { GeneratorSummary } from "@/lib/generator";

/**
 * The catalog, continuing as it is scrolled.
 *
 * The first page arrives server rendered from the page that holds this, so
 * the grid is there before any of this mounts.
 */
export function GeneratorFeed({
    initial,
    cursor,
}: {
    initial: GeneratorSummary[];
    cursor?: string;
}) {
    return (
        <InfiniteScroll
            initial={initial}
            initialCursor={cursor}
            load={moreGenerators}
            label="generators"
            itemKey={(generator) => generator.address}
        >
            {(generators) => <GeneratorGrid generators={generators} />}
        </InfiniteScroll>
    );
}
