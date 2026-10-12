"use client";

import { Plus, X } from "lucide-react";
import { AccountName } from "@/components/account/AccountName";
import { isSplitAddress } from "./SplitTable";

/**
 * Who made the work. Addresses and nothing else.
 *
 * No percentages here on purpose: being one of the artists and taking a
 * share of the money are different questions, asked in different places, and
 * a column of numbers beside a name is what made them look like one question.
 * Someone can be an artist and take nothing, or take a share and have made
 * nothing.
 *
 * Everyone listed has to accept before they are credited anywhere, so this is
 * an invitation and not an assertion about them.
 */
export function ArtistList({
    artists,
    onChange,
    owner,
    disabled,
}: {
    /** Co-artists. The connected wallet is always one and is not in here. */
    artists: string[];
    onChange: (artists: string[]) => void;
    owner?: string;
    disabled?: boolean;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">
                    {owner ? <AccountName address={owner} /> : "You"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">you, always</span>
            </div>

            {artists.map((a, i) => (
                // The index, not the value: keying on a field being typed
                // remounts the input every keystroke and loses the caret.
                <div key={i} className="flex items-center gap-2">
                    <input
                        value={a}
                        onChange={(e) =>
                            onChange(artists.map((v, j) => (i === j ? e.target.value.trim() : v)))
                        }
                        placeholder="tz1…"
                        aria-label="Artist address"
                        spellCheck={false}
                        className={`min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs ${
                            a && !isSplitAddress(a) ? "border-destructive" : "border-border"
                        }`}
                    />
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(artists.filter((_, j) => j !== i))}
                        aria-label="Remove"
                        className="shrink-0 rounded-md border border-border p-1.5 hover:bg-accent disabled:opacity-60"
                    >
                        <X size={14} aria-hidden />
                    </button>
                </div>
            ))}

            <button
                type="button"
                disabled={disabled}
                onClick={() => onChange([...artists, ""])}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
                <Plus size={13} aria-hidden />
                Add an artist
            </button>
        </div>
    );
}
