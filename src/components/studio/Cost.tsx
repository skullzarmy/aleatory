"use client";

import { useEffect, useState } from "react";
import { formatTez } from "@/lib/utils";
import { NETWORK } from "@/lib/config";

/**
 * What publishing this generator costs.
 *
 * Both figures come from the chain at the moment you look, rather than from a
 * constant in this file. Protocol constants change, and a number that used to
 * be right is worse than no number.
 */
const RPC: Record<string, string> = {
    shadownet: "https://rpc.tzkt.io/shadownet",
    mainnet: "https://rpc.tzkt.io/mainnet",
};

interface Constants {
    costPerByte: number;
    maxOperationBytes: number;
}

export function Cost({ html, editionSize }: { html: string; editionSize?: number }) {
    const [constants, setConstants] = useState<Constants | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void fetch(`${RPC[NETWORK]}/chains/main/blocks/head/context/constants`)
            .then((r) => r.json())
            .then((c: { cost_per_byte: string; max_operation_data_length: number }) => {
                if (cancelled) return;
                setConstants({
                    costPerByte: Number(c.cost_per_byte),
                    maxOperationBytes: Number(c.max_operation_data_length),
                });
            })
            .catch(() => !cancelled && setError(true));
        return () => {
            cancelled = true;
        };
    }, []);

    const bytes = new TextEncoder().encode(html).length;

    if (error) {
        return (
            <p className="text-sm text-muted-foreground">
                Could not check what storage costs right now.
            </p>
        );
    }
    if (!constants) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    const burn = bytes * constants.costPerByte;
    const overSized = bytes > constants.maxOperationBytes;

    return (
        <div className="space-y-4">
            <div>
                <p className="text-3xl font-semibold tracking-tight">
                    {formatTez(burn)} ꜩ
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                    one-off, to store your {bytes.toLocaleString("en-US")}-byte generator on chain.
                </p>
            </div>

            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                <Row label="Generator" value={`${bytes.toLocaleString("en-US")} bytes`} />
                <Row
                    label="Storage"
                    value={`${constants.costPerByte} mutez per byte`}
                />
                <Row
                    label="Size limit"
                    value={`${constants.maxOperationBytes.toLocaleString("en-US")} bytes`}
                />
                <Row
                    label="Per mint"
                    value="around 0.05 ꜩ, paid by the collector"
                />
            </dl>

            {overSized && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    This generator is too big to publish. Trim it down, or move a library
                    out of it, and try again.
                </p>
            )}

            {editionSize === undefined ? (
                <p className="text-xs text-muted-foreground">
                    Paid once when you publish, whatever size the edition ends up being.
                </p>
            ) : editionSize === 0 ? (
                <p className="text-xs text-muted-foreground">
                    Open edition. Collectors pay the mint cost each time; you pay the above
                    once.
                </p>
            ) : (
                <p className="text-xs text-muted-foreground">
                    Edition of {editionSize}. You pay the above once.
                </p>
            )}
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
        </div>
    );
}
