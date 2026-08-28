"use client";

import { useState } from "react";
import { Action } from "./Action";
import { SETTERS, type SetterKey } from "@/lib/ops";
import { bps as fmtBps, tez } from "@/lib/format";

const ADDRESS = /^(tz1|tz2|tz3|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;

export type Kind = "address" | "bps" | "mutez";

function parse(kind: Kind, raw: string): { value: string | number; valid: boolean } {
    if (kind === "address") return { value: raw.trim(), valid: ADDRESS.test(raw.trim()) };
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === "") return { value: 0, valid: false };
    if (kind === "bps") {
        // Typed as a percentage, stored as basis points. The contract caps it
        // at 1000 and rejects anything above, so it is refused here too.
        const b = Math.round(n * 100);
        return { value: b, valid: b >= 0 && b <= 1000 };
    }
    return { value: Math.round(n * 1_000_000), valid: n >= 0 };
}

function show(kind: Kind, value: string | number): string {
    if (kind === "address") return String(value);
    if (kind === "bps") return fmtBps(Number(value));
    return tez(Number(value));
}

/**
 * Change one stored value, showing what it is now and what it would become.
 *
 * The before and after are the point. Every one of these is a single opaque
 * number or address in storage, and confirming a change to one without seeing
 * what it replaces is how a fee becomes 25% instead of 2.5%.
 */
export function Setting({
    label,
    help,
    kind,
    current,
    holder,
    setter,
    contract,
    placeholder,
}: {
    label: string;
    help?: string;
    kind: Kind;
    /** The value in storage now, in the contract's own units. */
    current: string | number;
    /** The address the chain requires for the change. */
    holder: string;
    setter: SetterKey;
    /** The contract to act on. */
    contract: string;
    placeholder?: string;
}) {
    const [raw, setRaw] = useState("");
    const { value, valid } = parse(kind, raw);
    const changed = valid && String(value) !== String(current);

    return (
        <div className="space-y-2">
            <p className="label">{label}</p>
            {help && <p className="text-xs text-dim">{help}</p>}

            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-dim">{show(kind, current)}</span>
                <span aria-hidden className="text-dim">
                    →
                </span>
                <label>
                    <span className="sr-only">New {label.toLowerCase()}</span>
                    <input
                        className={`rounded border bg-base px-2 py-1 font-mono text-sm ${
                            kind === "address" ? "w-80 max-w-full" : "w-28"
                        } ${raw !== "" && !valid ? "border-bad" : "border-line"}`}
                        inputMode={kind === "address" ? "text" : "decimal"}
                        placeholder={placeholder ?? (kind === "address" ? "tz1…" : "")}
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                    />
                </label>
                {kind === "bps" && <span className="text-dim">%</span>}
                {kind === "mutez" && <span className="text-dim">ꜩ</span>}
            </div>

            {raw !== "" && !valid && (
                <p className="text-xs text-bad">
                    {kind === "address"
                        ? "Not a tz1, tz2, tz3 or KT1 address."
                        : kind === "bps"
                          ? "The contract caps the fee at 10%."
                          : "Not an amount."}
                </p>
            )}

            {changed && <Action op={SETTERS[setter](contract, value)} holder={holder} />}
        </div>
    );
}

/**
 * Append a value to a list, rather than replace one.
 *
 * `add_factory` and `add_writer` both grow a list that nothing removes from,
 * so there is no current value to show against, only what is already there.
 */
export function AddToList({
    label,
    help,
    holder,
    setter,
    contract,
}: {
    label: string;
    help?: string;
    holder: string;
    setter: SetterKey;
    contract: string;
}) {
    const [raw, setRaw] = useState("");
    const address = raw.trim();
    const valid = ADDRESS.test(address);

    return (
        <div className="space-y-2">
            <p className="label">{label}</p>
            {help && <p className="text-xs text-dim">{help}</p>}
            <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="sr-only">{label}</span>
                <input
                    className={`w-80 max-w-full rounded border bg-base px-2 py-1 font-mono text-sm ${
                        raw !== "" && !valid ? "border-bad" : "border-line"
                    }`}
                    placeholder="KT1…"
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                />
            </label>
            {valid && <Action op={SETTERS[setter](contract, address)} holder={holder} />}
        </div>
    );
}
