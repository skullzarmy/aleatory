"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeneratorGrid } from "./GeneratorCard";
import { GeneratorSortFilter } from "./GeneratorSortFilter";
import { BRAND } from "@/lib/config";
import type { GeneratorSummary } from "@/lib/generator";
import { sortGenerators, type GeneratorSortKey } from "@/lib/generator-sort";

const PAGE_SIZE = 24;

/**
 * The live generator catalog, with instant in-memory sorting, sold-out filtering,
 * and progressive rendering on scroll.
 */
export function GeneratorFeed({
    initial,
    initialSort = "created-desc",
    initialHideSoldOut = false,
}: {
    initial: GeneratorSummary[];
    initialSort?: GeneratorSortKey;
    initialHideSoldOut?: boolean;
}) {
    const [selectedSort, setSelectedSort] = useState<GeneratorSortKey>(initialSort);
    const [hideSoldOut, setHideSoldOut] = useState<boolean>(initialHideSoldOut);
    const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSelectedSort(initialSort);
    }, [initialSort]);

    useEffect(() => {
        setHideSoldOut(initialHideSoldOut);
    }, [initialHideSoldOut]);

    const syncUrl = useCallback((sort: GeneratorSortKey, hide: boolean) => {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (sort === "created-desc") {
            url.searchParams.delete("sort");
        } else {
            url.searchParams.set("sort", sort);
        }
        if (hide) {
            url.searchParams.set("soldOut", "hide");
        } else {
            url.searchParams.delete("soldOut");
        }
        window.history.replaceState(null, "", url.pathname + url.search);
    }, []);

    const handleSortChange = useCallback(
        (newSort: GeneratorSortKey) => {
            if (newSort === selectedSort) return;
            setSelectedSort(newSort);
            setVisibleCount(PAGE_SIZE);
            syncUrl(newSort, hideSoldOut);
        },
        [selectedSort, hideSoldOut, syncUrl],
    );

    const handleToggleSoldOut = useCallback(() => {
        const next = !hideSoldOut;
        setHideSoldOut(next);
        setVisibleCount(PAGE_SIZE);
        syncUrl(selectedSort, next);
    }, [hideSoldOut, selectedSort, syncUrl]);

    const filteredGenerators = useMemo(() => {
        const list = hideSoldOut
            ? initial.filter((c) => !(c.editionSize > 0 && c.minted >= c.editionSize))
            : initial;
        return sortGenerators(list, selectedSort);
    }, [initial, hideSoldOut, selectedSort]);

    const visibleGenerators = useMemo(
        () => filteredGenerators.slice(0, visibleCount),
        [filteredGenerators, visibleCount],
    );

    const hasMore = visibleCount < filteredGenerators.length;

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setVisibleCount((prev) =>
                        Math.min(prev + PAGE_SIZE, filteredGenerators.length),
                    );
                }
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, filteredGenerators.length]);

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h1 className="text-xl font-semibold tracking-tight">Generators</h1>
                    <p className="text-sm text-muted-foreground">Every generator on {BRAND.name}</p>
                </div>
                <GeneratorSortFilter
                    currentSort={selectedSort}
                    onSortChange={handleSortChange}
                    hideSoldOut={hideSoldOut}
                    onToggleSoldOut={handleToggleSoldOut}
                />
            </div>

            <div>
                {filteredGenerators.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                        <h2 className="text-base font-medium">No generators match your filter</h2>
                        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                            Try showing sold out generators or choosing a different sort.
                        </p>
                    </div>
                ) : (
                    <>
                        <GeneratorGrid generators={visibleGenerators} />

                        {hasMore && (
                            <div
                                ref={sentinelRef}
                                className="py-8 text-center text-sm text-muted-foreground"
                            >
                                <span>Loading more</span>
                            </div>
                        )}

                        {!hasMore && filteredGenerators.length > 0 && (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                {filteredGenerators.length}{" "}
                                {filteredGenerators.length === 1 ? "generator" : "generators"},
                                which is all of them
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
