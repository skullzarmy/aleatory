"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InfiniteScroll } from "./InfiniteScroll";
import { FeedGrid } from "./FeedGrid";
import { PieceSortFilter, type PieceSortKey } from "./PieceSortFilter";
import { morePieces } from "@/app/feed-actions";
import type { FeedPiece } from "@/lib/feed";

export function sortPieces(
    pieces: FeedPiece[],
    sortKey: PieceSortKey,
    prices?: Map<string, bigint>,
): FeedPiece[] {
    if (sortKey === "recent") return pieces;
    const sorted = [...pieces];
    if (sortKey === "oldest") {
        return sorted.sort((a, b) => {
            if (a.mintedAt && b.mintedAt) {
                return a.mintedAt.localeCompare(b.mintedAt);
            }
            return 0;
        });
    }
    if (sortKey === "price-asc" || sortKey === "price-desc") {
        return sorted.sort((a, b) => {
            const priceA = prices?.get(a.key);
            const priceB = prices?.get(b.key);
            const hasA = priceA !== undefined;
            const hasB = priceB !== undefined;

            if (hasA && hasB) {
                if (priceA! < priceB!) return sortKey === "price-asc" ? -1 : 1;
                if (priceA! > priceB!) return sortKey === "price-asc" ? 1 : -1;
                return 0;
            }
            // Listed pieces sort first; unlisted pieces sort to bottom for both directions.
            if (hasA && !hasB) return -1;
            if (!hasA && hasB) return 1;
            return 0;
        });
    }
    return sorted;
}

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
    initialPrices = [],
    initialSort = "recent",
    initialForSaleOnly = false,
}: {
    initial: FeedPiece[];
    cursor?: string;
    /** Entries, because a Map does not survive the server boundary. */
    artists: [string, string[]][];
    /** Narrowed to one generator, when the page is. */
    generator?: string;
    initialPrices?: [string, string][];
    initialSort?: PieceSortKey;
    initialForSaleOnly?: boolean;
}) {
    const [currentSort, setCurrentSort] = useState<PieceSortKey>(initialSort);
    const [forSaleOnly, setForSaleOnly] = useState<boolean>(initialForSaleOnly);

    useEffect(() => {
        setCurrentSort(initialSort);
    }, [initialSort]);

    useEffect(() => {
        setForSaleOnly(initialForSaleOnly);
    }, [initialForSaleOnly]);

    const syncUrl = useCallback((sort: PieceSortKey, forSale: boolean) => {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (sort === "recent") {
            url.searchParams.delete("sort");
        } else {
            url.searchParams.set("sort", sort);
        }
        if (forSale) {
            url.searchParams.set("forSale", "true");
        } else {
            url.searchParams.delete("forSale");
        }
        window.history.replaceState(null, "", url.pathname + url.search);
    }, []);

    const handleSortChange = useCallback(
        (newSort: PieceSortKey) => {
            if (newSort === currentSort) return;
            setCurrentSort(newSort);
            syncUrl(newSort, forSaleOnly);
        },
        [currentSort, forSaleOnly, syncUrl],
    );

    const handleToggleForSale = useCallback(() => {
        const next = !forSaleOnly;
        setForSaleOnly(next);
        syncUrl(currentSort, next);
    }, [currentSort, forSaleOnly, syncUrl]);

    // Held outside React state: the grid re-renders from `items`, and this is
    // a lookup those items read, so a page that arrives with new creators has
    // them in hand by the time the cards render.
    const known = useMemo(() => new Map(artists), [artists]);
    const pricesMap = useMemo(
        () => new Map(initialPrices.map(([k, v]) => [k, BigInt(v)])),
        [initialPrices],
    );

    const load = useCallback(
        async (at: string) => {
            const next = await morePieces(at, generator);
            for (const [address, creators] of next.artists) known.set(address, creators);
            return { items: next.items, cursor: next.cursor };
        },
        [generator, known],
    );

    return (
        <InfiniteScroll
            key={generator ?? "all"}
            initial={initial}
            initialCursor={cursor}
            load={load}
            label="pieces"
            itemKey={(piece) => piece.key}
        >
            {(pieces) => (
                <PieceGridSection
                    pieces={pieces}
                    artists={known}
                    prices={pricesMap}
                    currentSort={currentSort}
                    forSaleOnly={forSaleOnly}
                    onSortChange={handleSortChange}
                    onToggleForSale={handleToggleForSale}
                />
            )}
        </InfiniteScroll>
    );
}

function PieceGridSection({
    pieces,
    artists,
    prices,
    currentSort,
    forSaleOnly,
    onSortChange,
    onToggleForSale,
}: {
    pieces: FeedPiece[];
    artists: Map<string, string[]>;
    prices: Map<string, bigint>;
    currentSort: PieceSortKey;
    forSaleOnly: boolean;
    onSortChange: (sort: PieceSortKey) => void;
    onToggleForSale: () => void;
}) {
    const visiblePieces = useMemo(() => {
        let list = pieces;
        if (forSaleOnly) {
            list = list.filter((p) => prices.has(p.key));
        }
        return sortPieces(list, currentSort, prices);
    }, [pieces, forSaleOnly, currentSort, prices]);

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                    {visiblePieces.length} {visiblePieces.length === 1 ? "piece" : "pieces"}
                </span>
                <PieceSortFilter
                    currentSort={currentSort}
                    onSortChange={onSortChange}
                    forSaleOnly={forSaleOnly}
                    onToggleForSale={onToggleForSale}
                />
            </div>

            {visiblePieces.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                    <h2 className="text-base font-medium">No pieces match your filter</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                        {forSaleOnly
                            ? "None of the loaded pieces are currently listed for sale."
                            : "No pieces found."}
                    </p>
                </div>
            ) : (
                <FeedGrid pieces={visiblePieces} artists={artists} prices={prices} />
            )}
        </div>
    );
}
