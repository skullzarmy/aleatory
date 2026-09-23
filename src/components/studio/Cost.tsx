"use client";

import { useEffect, useState } from "react";
import { formatTez } from "@/lib/utils";
import { NETWORK } from "@/lib/config";
import { publishPlan, type PublishPlan } from "@/lib/plan";

// Cost figures are fetched from the chain rather than hardcoded, since
// protocol constants (cost per byte, size limits) can change.
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

    // How this source actually gets on chain, from the same function the
    // publisher uses. Comparing its size against one operation's ceiling said
    // "too big to publish" for anything over 32KB, which is a generator the
    // publisher walks on chain in a few more signatures.
    const [plan, setPlan] = useState<PublishPlan | null>(null);
    useEffect(() => {
        let cancelled = false;
        void publishPlan(html).then((p) => !cancelled && setPlan(p));
        return () => {
            cancelled = true;
        };
    }, [html]);

    const bytes = new TextEncoder().encode(html).length;

    if (error) {
        return (
            <p className="text-sm text-muted-foreground">
                Could not check what storage costs right now.
            </p>
        );
    }
    if (!constants || !plan) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    // Storage is paid on the bytes that land in it, which for anything past one
    // operation is the gzipped source.
    const burn = plan.codeBytes * constants.costPerByte;

    return (
        <div className="space-y-4">
            <div>
                <p className="text-3xl font-semibold tracking-tight">{formatTez(burn)} ꜩ</p>
                <p className="mt-1 text-sm text-muted-foreground">
                    {plan.route === "pointer"
                        ? `one-off. Your ${bytes.toLocaleString("en-US")}-byte generator is stored off chain, so there is no storage burn for it.`
                        : `one-off, to store your ${bytes.toLocaleString("en-US")}-byte generator on chain.`}
                </p>
            </div>

            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                <Row label="Generator" value={`${bytes.toLocaleString("en-US")} bytes`} />
                {plan.codeEncoding === "gzip" && (
                    <Row
                        label="Compressed"
                        value={`${plan.code.length.toLocaleString("en-US")} bytes, gzip`}
                    />
                )}
                <Row label="Storage" value={`${constants.costPerByte} mutez per byte`} />
                <Row
                    label="Per operation"
                    value={`${constants.maxOperationBytes.toLocaleString("en-US")} bytes`}
                />
                <Row
                    label="Signatures"
                    value={
                        plan.signatures === 1
                            ? "1, the deploy"
                            : `${plan.signatures}: the deploy, ${plan.chunks} chunks, and the seal`
                    }
                />
                <Row label="Per mint" value="around 0.05 ꜩ, paid by the collector" />
            </dl>

            {plan.route === "walked" && (
                <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
                    Bigger than one operation, so it is compressed and walked on chain a chunk at a
                    time. That is {plan.signatures} wallet prompts instead of one, and the art is
                    still fully on chain.
                </p>
            )}

            {plan.route === "pointer" && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    Too big to walk on chain in a reasonable number of signatures, so the source
                    would be stored off chain and the contract would hold a pointer to it. Trim it
                    down, or move a library out of it, to keep the art on chain.
                </p>
            )}

            {editionSize === undefined ? (
                <p className="text-xs text-muted-foreground">
                    Paid once when you publish, whatever size the edition ends up being.
                </p>
            ) : editionSize === 0 ? (
                <p className="text-xs text-muted-foreground">
                    Open edition. Collectors pay the mint cost each time; you pay the above once.
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
