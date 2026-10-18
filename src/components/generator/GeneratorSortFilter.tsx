"use client";

import { memo, type ComponentType } from "react";
import {
    Sparkles,
    History,
    Layers,
    Hourglass,
    TrendingUp,
    BarChart2,
    ArrowDown10,
    ArrowUp10,
    ArrowDownAZ,
    ArrowUpZA,
    ChevronDown,
    Check,
    Loader2,
    Eye,
    EyeOff,
} from "lucide-react";
import type { GeneratorSortKey } from "@/lib/generator-sort";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface SortOptionDef {
    key: GeneratorSortKey;
    label: string;
    category: string;
    icon: ComponentType<{ className?: string; strokeWidth?: number }>;
    description: string;
}

export const SORT_OPTIONS: SortOptionDef[] = [
    {
        key: "created-desc",
        label: "Newest first",
        category: "Date",
        icon: Sparkles,
        description: "Most recently originated",
    },
    {
        key: "created-asc",
        label: "Oldest first",
        category: "Date",
        icon: History,
        description: "Earliest originated",
    },
    {
        key: "remaining-desc",
        label: "Remaining: High to low",
        category: "Supply",
        icon: Layers,
        description: "Most pieces left to mint",
    },
    {
        key: "remaining-asc",
        label: "Remaining: Low to high",
        category: "Supply",
        icon: Hourglass,
        description: "Fewest left / close to sold out",
    },
    {
        key: "minted-desc",
        label: "Minted: High to low",
        category: "Mints",
        icon: TrendingUp,
        description: "Highest edition count minted",
    },
    {
        key: "minted-asc",
        label: "Minted: Low to high",
        category: "Mints",
        icon: BarChart2,
        description: "Lowest edition count minted",
    },
    {
        key: "price-asc",
        label: "Price: Low to high",
        category: "Price",
        icon: ArrowDown10,
        description: "Lowest mint price first",
    },
    {
        key: "price-desc",
        label: "Price: High to low",
        category: "Price",
        icon: ArrowUp10,
        description: "Highest mint price first",
    },
    {
        key: "artist-asc",
        label: "Artist: A to Z",
        category: "Artist",
        icon: ArrowDownAZ,
        description: "Alphabetical by alias or address",
    },
    {
        key: "artist-desc",
        label: "Artist: Z to A",
        category: "Artist",
        icon: ArrowUpZA,
        description: "Reverse alphabetical by alias or address",
    },
];

export const SORT_OPTIONS_BY_KEY = new Map(SORT_OPTIONS.map((opt) => [opt.key, opt]));

interface GeneratorSortFilterProps {
    currentSort: GeneratorSortKey;
    onSortChange: (sort: GeneratorSortKey) => void;
    hideSoldOut: boolean;
    onToggleSoldOut: () => void;
    isPending?: boolean;
}

export const GeneratorSortFilter = memo(function GeneratorSortFilter({
    currentSort,
    onSortChange,
    hideSoldOut,
    onToggleSoldOut,
    isPending = false,
}: GeneratorSortFilterProps) {
    const activeOption = SORT_OPTIONS_BY_KEY.get(currentSort) || SORT_OPTIONS[0];
    const ActiveIcon = activeOption.icon;

    return (
        <div className="flex items-center gap-2">
            <span className="sr-only" aria-live="polite">
                {isPending
                    ? "Loading generators..."
                    : `Sorted by ${activeOption.label}, sold out generators ${hideSoldOut ? "hidden" : "visible"}`}
            </span>

            {/* Sold out toggle button */}
            <button
                type="button"
                onClick={onToggleSoldOut}
                aria-pressed={!hideSoldOut}
                aria-label={hideSoldOut ? "Show sold out generators" : "Hide sold out generators"}
                className={cn(
                    "inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-all select-none active:scale-[0.98] cursor-pointer",
                    "hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    hideSoldOut ? "text-muted-foreground" : "text-foreground",
                )}
            >
                {hideSoldOut ? (
                    <EyeOff
                        strokeWidth={2.25}
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                    />
                ) : (
                    <Eye
                        strokeWidth={2.25}
                        className="size-4 shrink-0 text-foreground"
                        aria-hidden="true"
                    />
                )}
                <span>Sold out</span>
            </button>

            {/* Dropdown selector for all 10 explicit options */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Sort generators: currently sorted by ${activeOption.label}`}
                        className={cn(
                            "inline-flex min-h-[40px] items-center justify-between gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-all active:scale-[0.98] cursor-pointer",
                            "hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isPending && "border-foreground/40",
                        )}
                    >
                        <span className="inline-flex items-center gap-2 truncate">
                            {isPending ? (
                                <Loader2
                                    strokeWidth={2.25}
                                    className="size-4 shrink-0 animate-spin text-foreground"
                                    aria-hidden="true"
                                />
                            ) : (
                                <ActiveIcon
                                    strokeWidth={2.25}
                                    className="size-4 shrink-0 text-foreground"
                                />
                            )}
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
                <DropdownMenuContent align="end" className="w-72 p-1.5 shadow-lg backdrop-blur-md">
                    <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                        Sort options
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {SORT_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const isSelected = currentSort === opt.key;
                        return (
                            <DropdownMenuItem
                                key={opt.key}
                                onClick={() => onSortChange(opt.key)}
                                className={cn(
                                    "flex min-h-[40px] items-center justify-between gap-3 px-2.5 py-2 text-xs cursor-pointer rounded-md",
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
