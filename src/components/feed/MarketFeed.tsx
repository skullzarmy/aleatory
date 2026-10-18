"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutoGrid } from "./AutoGrid";
import { ListingCard } from "./ListingCard";
import { GeneratorDropdown, type GeneratorOption } from "./GeneratorDropdown";
import { MarketSortFilter, type MarketSortKey } from "./MarketSortFilter";
import type { FeedPiece } from "@/lib/feed";
import type { Listing } from "@/lib/market";
import { formatTez, shortAddress } from "@/lib/utils";

const PAGE_SIZE = 24;

export type SerializedListing = Omit<Listing, "priceMutez"> & { priceMutez: string };

export function sortListings(listings: Listing[], sortKey: MarketSortKey): Listing[] {
    const sorted = [...listings];
    if (sortKey === "recent") {
        return sorted.sort((a, b) => b.id - a.id);
    }
    if (sortKey === "oldest") {
        return sorted.sort((a, b) => a.id - b.id);
    }
    if (sortKey === "price-asc") {
        return sorted.sort((a, b) => {
            if (a.priceMutez < b.priceMutez) return -1;
            if (a.priceMutez > b.priceMutez) return 1;
            return b.id - a.id;
        });
    }
    if (sortKey === "price-desc") {
        return sorted.sort((a, b) => {
            if (a.priceMutez > b.priceMutez) return -1;
            if (a.priceMutez < b.priceMutez) return 1;
            return b.id - a.id;
        });
    }
    return sorted;
}

export function MarketFeed({
    initialListings,
    initialPieces,
    generators,
    artists,
    names,
    initialGenerator,
    initialSort = "recent",
    marketplace,
}: {
    initialListings: SerializedListing[];
    initialPieces: [string, FeedPiece][];
    generators: GeneratorOption[];
    artists: [string, string[]][];
    names: [string, string][];
    initialGenerator?: string;
    initialSort?: MarketSortKey;
    marketplace?: string;
}) {
    const [rawListings, setRawListings] = useState<SerializedListing[]>(initialListings);
    const [selectedGenerator, setSelectedGenerator] = useState<string | undefined>(
        initialGenerator,
    );
    const [currentSort, setCurrentSort] = useState<MarketSortKey>(initialSort);
    const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setRawListings(initialListings);
    }, [initialListings]);

    useEffect(() => {
        setSelectedGenerator(initialGenerator);
    }, [initialGenerator]);

    useEffect(() => {
        setCurrentSort(initialSort);
    }, [initialSort]);

    const syncUrl = useCallback((gen?: string, sort?: MarketSortKey) => {
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
        url.searchParams.delete("page");
        window.history.replaceState(null, "", url.pathname + url.search);
    }, []);

    const handleGeneratorSelect = useCallback(
        (address?: string) => {
            setSelectedGenerator(address);
            setVisibleCount(PAGE_SIZE);
            syncUrl(address, currentSort);
        },
        [currentSort, syncUrl],
    );

    const handleSortChange = useCallback(
        (newSort: MarketSortKey) => {
            if (newSort === currentSort) return;
            setCurrentSort(newSort);
            setVisibleCount(PAGE_SIZE);
            syncUrl(selectedGenerator, newSort);
        },
        [selectedGenerator, currentSort, syncUrl],
    );

    const namesMap = useMemo(() => new Map(names), [names]);
    const artistsMap = useMemo(() => new Map(artists), [artists]);
    const piecesMap = useMemo(() => new Map(initialPieces), [initialPieces]);

    const parsedListings = useMemo<Listing[]>(
        () =>
            rawListings.map((l) => ({
                ...l,
                priceMutez: BigInt(l.priceMutez),
            })),
        [rawListings],
    );

    const dropdownGenerators = useMemo<GeneratorOption[]>(() => {
        if (!selectedGenerator) return generators;
        const exists = generators.some((g) => g.address === selectedGenerator);
        if (exists) return generators;
        const name = namesMap.get(selectedGenerator) || shortAddress(selectedGenerator);
        return [{ address: selectedGenerator, name, count: 0 }, ...generators];
    }, [generators, selectedGenerator, namesMap]);

    const scopedName = useMemo(() => {
        if (!selectedGenerator) return undefined;
        return namesMap.get(selectedGenerator) || shortAddress(selectedGenerator);
    }, [selectedGenerator, namesMap]);

    const filteredListings = useMemo(() => {
        let list = parsedListings;
        if (selectedGenerator) {
            list = list.filter((l) => l.generator === selectedGenerator);
        }
        return sortListings(list, currentSort);
    }, [parsedListings, selectedGenerator, currentSort]);

    const floorMutez = useMemo<bigint | null>(() => {
        if (filteredListings.length === 0) return null;
        return filteredListings.reduce<bigint>(
            (min, l) => (l.priceMutez < min ? l.priceMutez : min),
            filteredListings[0].priceMutez,
        );
    }, [filteredListings]);

    const visibleListings = useMemo(
        () => filteredListings.slice(0, visibleCount),
        [filteredListings, visibleCount],
    );

    const hasMore = visibleCount < filteredListings.length;

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredListings.length));
                }
            },
            { rootMargin: "800px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, filteredListings.length]);

    return (
        <div>
            {/* Header summary */}
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h1 className="text-xl font-semibold tracking-tight">Market</h1>
                <p className="text-sm text-muted-foreground">
                    {filteredListings.length > 0 && floorMutez !== null
                        ? `${filteredListings.length} for sale${scopedName ? ` from ${scopedName}` : ""}, from ${formatTez(floorMutez)} ꜩ`
                        : "2.5% of each sale, royalties paid from the generator"}
                </p>
            </div>

            {/* Toolbar: Generator Dropdown on Left, Sort Dropdown on Right */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <GeneratorDropdown
                    generators={dropdownGenerators}
                    selected={selectedGenerator}
                    onSelect={handleGeneratorSelect}
                    totalCount={parsedListings.length}
                />
                <MarketSortFilter currentSort={currentSort} onSortChange={handleSortChange} />
            </div>

            {/* Content Grid */}
            {filteredListings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                    <h2 className="text-base font-medium">Nothing listed</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                        {!marketplace
                            ? "The marketplace is waiting to be deployed."
                            : selectedGenerator
                              ? `Nothing from ${scopedName || "this generator"} is for sale right now.`
                              : "Pieces listed for sale show up here."}
                    </p>
                    {selectedGenerator && (
                        <button
                            type="button"
                            onClick={() => handleGeneratorSelect(undefined)}
                            className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
                        >
                            See everything for sale
                        </button>
                    )}
                </div>
            ) : (
                <>
                    <AutoGrid className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {visibleListings.map((l, i) => (
                            <ListingCard
                                key={`${l.marketplace}:${l.id}`}
                                listing={l}
                                piece={piecesMap.get(`${l.generator}:${l.tokenId}`)}
                                artists={artistsMap.get(l.generator)}
                                priority={i < 4}
                            />
                        ))}
                    </AutoGrid>

                    {hasMore && (
                        <div
                            ref={sentinelRef}
                            className="py-8 text-center text-sm text-muted-foreground"
                        >
                            <span>Loading more</span>
                        </div>
                    )}

                    {!hasMore && filteredListings.length > 0 && (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            {filteredListings.length}{" "}
                            {filteredListings.length === 1 ? "listing" : "listings"}, which is all
                            of them
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
