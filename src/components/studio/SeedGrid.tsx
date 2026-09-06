"use client";

import { Frame } from "./Frame";
import { seedAt } from "@/lib/draft";
import type { ParamSpec } from "@/lib/params";

// All sixteen seeds derive from one base seed, so the same base always
// reproduces the same grid.
export function SeedGrid({
    html,
    baseSeed,
    params,
    values,
    deps,
    count = 16,
    onPick,
}: {
    html: string;
    baseSeed: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    deps?: string[];
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
                        {/* pointer-events-none so the click hits the button, not the frame. */}
                        <span className="pointer-events-none absolute inset-0">
                            <Frame
                                html={html}
                                seed={seed}
                                params={params}
                                values={values}
                                deps={deps}
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
