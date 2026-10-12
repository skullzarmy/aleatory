"use client";

import { Plus, X } from "lucide-react";
import { AccountName } from "@/components/account/AccountName";

export interface SplitRow {
    address: string;
    /** Percent, as typed. Parsed by the caller. */
    percent: string;
}

const ADDRESS = /^(tz[1234]|KT1)[0-9A-Za-z]{33}$/;

export function isSplitAddress(a: string): boolean {
    return ADDRESS.test(a.trim());
}

/**
 * Who shares something, and what each of them gets.
 *
 * The person deploying always holds whatever the named rows leave, shown
 * here and never typed: the contract wants the shares to total exactly 100%
 * and to include the signer, and a remainder row is the only arrangement
 * where both are true however the numbers are edited.
 */
export function SplitTable({
    rows,
    onChange,
    owner,
    ownerPercent,
    rowsLeft,
    addLabel,
    disabled,
    ownerLabel,
}: {
    rows: SplitRow[];
    onChange: (rows: SplitRow[]) => void;
    /** The connected wallet, which holds the remainder. */
    owner?: string;
    ownerPercent: number;
    /** How many more rows may be added, across every table sharing the cap. */
    rowsLeft: number;
    addLabel: string;
    disabled?: boolean;
    /** Shown beside the owner's remainder. Omitted when it needs no saying. */
    ownerLabel?: string;
}) {
    const set = (i: number, next: Partial<SplitRow>) =>
        onChange(rows.map((r, j) => (i === j ? { ...r, ...next } : r)));

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">
                    {owner ? <AccountName address={owner} /> : "You"}
                    {ownerLabel && <span className="ml-1.5 text-xs">{ownerLabel}</span>}
                </span>
                <span
                    className={`shrink-0 font-medium tabular-nums ${
                        ownerPercent < 0 ? "text-destructive" : ""
                    }`}
                >
                    {ownerPercent.toFixed(2)}%
                </span>
            </div>

            {rows.map((row, i) => (
                // The index, not the address: keying on a field being typed
                // remounts the input on every keystroke and loses the caret.
                <div key={i} className="flex items-center gap-2">
                    <input
                        value={row.address}
                        onChange={(e) => set(i, { address: e.target.value.trim() })}
                        placeholder="tz1…"
                        aria-label="Collaborator address"
                        spellCheck={false}
                        className={`min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs ${
                            row.address && !isSplitAddress(row.address)
                                ? "border-destructive"
                                : "border-border"
                        }`}
                    />
                    <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step={1}
                        value={row.percent}
                        onChange={(e) => set(i, { percent: e.target.value })}
                        aria-label="Share, percent"
                        className="w-20 shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
                    />
                    <span className="shrink-0 text-sm text-muted-foreground">%</span>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(rows.filter((_, j) => j !== i))}
                        aria-label="Remove"
                        className="shrink-0 rounded-md border border-border p-1.5 hover:bg-accent disabled:opacity-60"
                    >
                        <X size={14} aria-hidden />
                    </button>
                </div>
            ))}

            {rowsLeft > 0 && (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange([...rows, { address: "", percent: "" }])}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
                >
                    <Plus size={13} aria-hidden />
                    {addLabel}
                </button>
            )}
        </div>
    );
}
