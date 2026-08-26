"use client";

import { Frame } from "./Frame";
import { seedAt } from "@/lib/draft";
import type { ParamSpec } from "@/lib/params";

/**
 * Sixteen seeds at once.
 *
 * The thing an artist looks at all day, because one draw says almost nothing
 * about a generator and a page of them says most of what there is to know.
 *
 * Grids are derived from one base seed, so a grid is reproducible: the same
 * base gives the same sixteen, and an artist can point at one of them.
 */
export function SeedGrid({
    html,
    baseSeed,
    params,
    values,
    count = 16,
    onPick,
}: {
    html: string;
    baseSeed: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    count?: number;
    onPick?: (seed: string) => void;
}) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => {
                const seed = seedAt(baseSeed, i);
                return (
                    <button
                        key={seed}
                        type="button"
                        onClick={() => onPick?.(seed)}
                        title={seed}
                        className="group relative aspect-square overflow-hidden rounded-md border border-border transition-shadow hover:shadow-lg"
                    >
                        {/* The frame must not eat the click: the whole tile
                            selects the seed. */}
                        <span className="pointer-events-none absolute inset-0">
                            <Frame
                                html={html}
                                seed={seed}
                                params={params}
                                values={values}
                            />
                        </span>
                        <span className="absolute bottom-0 left-0 right-0 bg-background/80 px-1.5 py-0.5 text-[10px] opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                            {i + 1}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
