"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedGrid } from "./FeedGrid";
import { PieceSortFilter, type PieceSortKey } from "./PieceSortFilter";
import { GeneratorDropdown } from "./GeneratorDropdown";
import type { FeedPiece } from "@/lib/feed";

const PAGE_SIZE = 24;

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
 * Minted pieces feed with instant in-memory generator filtering,
 * for-sale toggling, price sorting, and progressive scroll rendering.
 */
export function PieceFeed({
    initial,
    generators,
    initialGenerator,
    initialPrices = [],
    initialSort = "recent",
    initialForSaleOnly = false,
    artists = [],
}: {
    initial: FeedPiece[];
    generators: { address: string; name: string }[];
    initialGenerator?: string;
    initialPrices?: [string, string][];
    initialSort?: PieceSortKey;
    initialForSaleOnly?: boolean;
    artists?: [string, string[]][];
}) {
    const [pieces, setPieces] = useState<FeedPiece[]>(initial);
    const [selectedGenerator, setSelectedGenerator] = useState<string | undefined>(
        initialGenerator,
    );
    const [currentSort, setCurrentSort] = useState<PieceSortKey>(initialSort);
    const [forSaleOnly, setForSaleOnly] = useState<boolean>(initialForSaleOnly);
    const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setPieces(initial);
    }, [initial]);

    useEffect(() => {
        setSelectedGenerator(initialGenerator);
    }, [initialGenerator]);

    useEffect(() => {
        setCurrentSort(initialSort);
    }, [initialSort]);

    useEffect(() => {
        setForSaleOnly(initialForSaleOnly);
    }, [initialForSaleOnly]);

    const syncUrl = useCallback((gen?: string, sort?: PieceSortKey, forSale?: boolean) => {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (gen) {
            url.searchParams.set("generator", gen);
        } else {
            url.searchParams.delete("generator");
        }
        if (sort && sort !== "recent") {
            url.searchParams.set("sort", sort);
        } else {
            url.searchParams.delete("sort");
        }
        if (forSale) {
            url.searchParams.set("forSale", "true");
        } else {
            url.searchParams.delete("forSale");
        }
        window.history.replaceState(null, "", url.pathname + url.search);
    }, []);

    const handleGeneratorSelect = useCallback(
        (address?: string) => {
            setSelectedGenerator(address);
            setVisibleCount(PAGE_SIZE);
            syncUrl(address, currentSort, forSaleOnly);
        },
        [currentSort, forSaleOnly, syncUrl],
    );

    const handleSortChange = useCallback(
        (newSort: PieceSortKey) => {
            if (newSort === currentSort) return;
            setCurrentSort(newSort);
            setVisibleCount(PAGE_SIZE);
            syncUrl(selectedGenerator, newSort, forSaleOnly);
        },
        [selectedGenerator, forSaleOnly, currentSort, syncUrl],
    );

    const handleToggleForSale = useCallback(() => {
        const next = !forSaleOnly;
        setForSaleOnly(next);
        setVisibleCount(PAGE_SIZE);
        syncUrl(selectedGenerator, currentSort, next);
    }, [selectedGenerator, currentSort, forSaleOnly, syncUrl]);

    const knownArtists = useMemo(() => new Map(artists), [artists]);
    const pricesMap = useMemo(
        () => new Map(initialPrices.map(([k, v]) => [k, BigInt(v)])),
        [initialPrices],
    );

    const filteredPieces = useMemo(() => {
        let list = pieces;
        if (selectedGenerator) {
            list = list.filter((p) => p.contract === selectedGenerator);
        }
        if (forSaleOnly) {
            list = list.filter((p) => pricesMap.has(p.key));
        }
        return sortPieces(list, currentSort, pricesMap);
    }, [pieces, selectedGenerator, forSaleOnly, currentSort, pricesMap]);

    const visiblePieces = useMemo(
        () => filteredPieces.slice(0, visibleCount),
        [filteredPieces, visibleCount],
    );

    const hasMore = visibleCount < filteredPieces.length;

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredPieces.length));
                }
            },
            { rootMargin: "800px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, filteredPieces.length]);

    const activeGenName = useMemo(() => {
        if (!selectedGenerator) return null;
        return (
            generators.find((g) => g.address === selectedGenerator)?.name ?? "Selected generator"
        );
    }, [generators, selectedGenerator]);

    return (
        <div>
            {/* Top Toolbar: Generator Dropdown on Left, For Sale Toggle and Sort on Right */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <GeneratorDropdown
                    generators={generators}
                    selected={selectedGenerator}
                    onSelect={handleGeneratorSelect}
                />
                <PieceSortFilter
                    currentSort={currentSort}
                    onSortChange={handleSortChange}
                    forSaleOnly={forSaleOnly}
                    onToggleForSale={handleToggleForSale}
                />
            </div>

            {/* Content Grid */}
            {filteredPieces.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                    <h2 className="text-base font-medium">No pieces match your filter</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                        {forSaleOnly
                            ? `There are no pieces currently listed for sale${activeGenName ? ` from ${activeGenName}` : ""}.`
                            : "No pieces found."}
                    </p>
                </div>
            ) : (
                <>
                    <FeedGrid pieces={visiblePieces} artists={knownArtists} prices={pricesMap} />

                    {hasMore && (
                        <div
                            ref={sentinelRef}
                            className="py-8 text-center text-sm text-muted-foreground"
                        >
                            <span>Loading more</span>
                        </div>
                    )}

                    {!hasMore && filteredPieces.length > 0 && (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            {filteredPieces.length}{" "}
                            {filteredPieces.length === 1 ? "piece" : "pieces"}, which is all of them
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
