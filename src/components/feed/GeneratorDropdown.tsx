"use client";

import { memo, useMemo, useState } from "react";
import { ChevronDown, Check, Layers, Search } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface GeneratorOption {
    address: string;
    name: string;
}

interface GeneratorDropdownProps {
    generators: GeneratorOption[];
    selected?: string;
    onSelect: (address?: string) => void;
}

export const GeneratorDropdown = memo(function GeneratorDropdown({
    generators,
    selected,
    onSelect,
}: GeneratorDropdownProps) {
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState(false);

    const selectedOption = useMemo(
        () => generators.find((g) => g.address === selected),
        [generators, selected],
    );

    const filteredGenerators = useMemo(() => {
        if (!search.trim()) return generators;
        const q = search.toLowerCase().trim();
        return generators.filter(
            (g) => g.name.toLowerCase().includes(q) || g.address.toLowerCase().includes(q),
        );
    }, [generators, search]);

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={`Filter by generator: currently showing ${selectedOption ? selectedOption.name : "All generators"}`}
                    className={cn(
                        "inline-flex min-h-[40px] max-w-[260px] sm:max-w-[320px] items-center justify-between gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-all active:scale-[0.98] cursor-pointer",
                        "hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    )}
                >
                    <span className="inline-flex items-center gap-2 truncate">
                        <Layers
                            strokeWidth={2.25}
                            className="size-4 shrink-0 text-foreground"
                            aria-hidden="true"
                        />
                        <span className="truncate">
                            <span className="text-muted-foreground">Generator:</span>{" "}
                            {selectedOption ? selectedOption.name : "All"}
                        </span>
                    </span>
                    <ChevronDown
                        strokeWidth={2}
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                    />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="w-72 sm:w-80 p-1.5 shadow-lg backdrop-blur-md"
            >
                <div className="px-2 py-1.5">
                    <DropdownMenuLabel className="p-0 text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                        Filter by generator
                    </DropdownMenuLabel>
                    <div className="relative mt-2">
                        <Search
                            className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            aria-hidden="true"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search generators..."
                            className="w-full rounded-md border border-border bg-muted/40 py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            onKeyDown={(e) => e.stopPropagation()}
                            aria-label="Search generators"
                        />
                    </div>
                </div>
                <DropdownMenuSeparator />

                <div className="max-h-64 overflow-y-auto">
                    <DropdownMenuItem
                        onClick={() => {
                            onSelect(undefined);
                            setOpen(false);
                            setSearch("");
                        }}
                        className={cn(
                            "flex min-h-[36px] items-center justify-between gap-3 px-2.5 py-2 text-xs cursor-pointer rounded-md",
                            !selected
                                ? "bg-accent font-medium text-accent-foreground"
                                : "text-foreground hover:bg-muted/80",
                        )}
                    >
                        <span className="truncate">All generators</span>
                        {!selected && (
                            <Check
                                strokeWidth={2.5}
                                className="size-4 shrink-0 text-foreground"
                                aria-hidden="true"
                            />
                        )}
                    </DropdownMenuItem>

                    {filteredGenerators.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-foreground">
                            No generators found
                        </div>
                    ) : (
                        filteredGenerators.map((g) => {
                            const isSelected = selected === g.address;
                            return (
                                <DropdownMenuItem
                                    key={g.address}
                                    onClick={() => {
                                        onSelect(g.address);
                                        setOpen(false);
                                        setSearch("");
                                    }}
                                    className={cn(
                                        "flex min-h-[36px] items-center justify-between gap-3 px-2.5 py-2 text-xs cursor-pointer rounded-md",
                                        isSelected
                                            ? "bg-accent font-medium text-accent-foreground"
                                            : "text-foreground hover:bg-muted/80",
                                    )}
                                >
                                    <span className="truncate">{g.name}</span>
                                    {isSelected && (
                                        <Check
                                            strokeWidth={2.5}
                                            className="size-4 shrink-0 text-foreground"
                                            aria-hidden="true"
                                        />
                                    )}
                                </DropdownMenuItem>
                            );
                        })
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
});
