"use client";

import { memo, type ComponentType } from "react";
import { Sparkles, History, ArrowDown10, ArrowUp10, ChevronDown, Check } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type MarketSortKey = "recent" | "oldest" | "price-asc" | "price-desc";

export interface MarketSortOptionDef {
    key: MarketSortKey;
    label: string;
    icon: ComponentType<{ className?: string; strokeWidth?: number }>;
    description: string;
}

export const MARKET_SORT_OPTIONS: MarketSortOptionDef[] = [
    {
        key: "recent",
        label: "Newest first",
        icon: Sparkles,
        description: "Most recently listed",
    },
    {
        key: "oldest",
        label: "Oldest first",
        icon: History,
        description: "Earliest listed",
    },
    {
        key: "price-asc",
        label: "Price: Low to high",
        icon: ArrowDown10,
        description: "Lowest price first",
    },
    {
        key: "price-desc",
        label: "Price: High to low",
        icon: ArrowUp10,
        description: "Highest price first",
    },
];

export const MARKET_SORT_OPTIONS_BY_KEY = new Map(MARKET_SORT_OPTIONS.map((opt) => [opt.key, opt]));

interface MarketSortFilterProps {
    currentSort: MarketSortKey;
    onSortChange: (sort: MarketSortKey) => void;
}

export const MarketSortFilter = memo(function MarketSortFilter({
    currentSort,
    onSortChange,
}: MarketSortFilterProps) {
    const activeOption = MARKET_SORT_OPTIONS_BY_KEY.get(currentSort) || MARKET_SORT_OPTIONS[0];
    const ActiveIcon = activeOption.icon;

    return (
        <div className="flex items-center gap-2">
            <span className="sr-only" aria-live="polite">
                {`Sorted by ${activeOption.label}`}
            </span>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Sort listings: currently sorted by ${activeOption.label}`}
                        className={cn(
                            "inline-flex min-h-[40px] items-center justify-between gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-all active:scale-[0.98] cursor-pointer",
                            "hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        )}
                    >
                        <span className="inline-flex items-center gap-2 truncate">
                            <ActiveIcon
                                strokeWidth={2.25}
                                className="size-4 shrink-0 text-foreground"
                            />
                            <span className="truncate">
                                <span className="text-muted-foreground">Sort:</span>{" "}
                                {activeOption.label}
                            </span>
                        </span>
                        <ChevronDown
                            strokeWidth={2}
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                        />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-1.5 shadow-lg backdrop-blur-md">
                    <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                        Sort options
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {MARKET_SORT_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const isSelected = currentSort === opt.key;
                        return (
                            <DropdownMenuItem
                                key={opt.key}
                                onClick={() => onSortChange(opt.key)}
                                className={cn(
                                    "flex min-h-[36px] items-center justify-between gap-3 px-2.5 py-2 text-xs cursor-pointer rounded-md",
                                    isSelected
                                        ? "bg-accent font-medium text-accent-foreground"
                                        : "text-foreground hover:bg-muted/80",
                                )}
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <Icon
                                        strokeWidth={2.25}
                                        className={cn(
                                            "size-4 shrink-0",
                                            isSelected
                                                ? "text-foreground"
                                                : "text-muted-foreground",
                                        )}
                                        aria-hidden="true"
                                    />
                                    <div className="flex flex-col min-w-0">
                                        <span className="truncate font-medium">{opt.label}</span>
                                        <span className="truncate text-[10px] text-muted-foreground">
                                            {opt.description}
                                        </span>
                                    </div>
                                </div>
                                {isSelected && (
                                    <Check
                                        strokeWidth={2.5}
                                        className="size-4 shrink-0 text-foreground"
                                        aria-hidden="true"
                                    />
                                )}
                            </DropdownMenuItem>
                        );
                    })}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
});
