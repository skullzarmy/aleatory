"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { formatTez } from "@/lib/utils";
import type { Collection } from "@/lib/collection";
import * as ops from "@/lib/ops";

/**
 * Buy one piece.
 *
 * One signature covers the price and the render gas together. The operation
 * hash becomes the seed, so the outcome is fixed by the collector's own
 * signature and known to nobody beforehand.
 */
export function MintPanel({ collection }: { collection: Collection }) {
    const { address, connect, getClient } = useWallet();
    const [busy, setBusy] = useState(false);
    const [hash, setHash] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const remaining =
        collection.editionSize > 0 ? collection.editionSize - collection.minted : null;

    async function mint() {
        setBusy(true);
        setError(null);
        try {
            const client = await getClient();
            // Parameters are not exposed in this panel yet, so an empty
            // document goes on chain.
            const res = await ops.buy(client, collection.address, "", collection.totalMutez);
            setHash(res.hash);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not go through");
        } finally {
            setBusy(false);
        }
    }

    if (hash) {
        return (
            <div className="space-y-2 rounded-lg border border-border p-4">
                <p className="text-sm font-medium">Minted</p>
                <p className="text-xs text-muted-foreground">
                    This operation hash is your piece&apos;s seed.
                </p>
                <p className="break-all font-mono text-xs">{hash}</p>
            </div>
        );
    }

    return (
        <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Price</span>
                <span className="text-lg font-semibold">
                    {formatTez(collection.priceMutez)} ꜩ
                </span>
            </div>

            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                <span>Render gas</span>
                <span>{formatTez(collection.renderGasMutez)} ꜩ</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm">
                <span>You pay</span>
                <span className="font-medium">{formatTez(collection.totalMutez)} ꜩ</span>
            </div>

            <p className="text-xs text-muted-foreground">
                {remaining === null
                    ? `${collection.minted} minted, open edition`
                    : `${remaining} of ${collection.editionSize} left`}
            </p>

            {collection.soldOut ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">Sold out</p>
            ) : collection.paused ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">Sales are paused</p>
            ) : (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => (address ? void mint() : void connect())}
                    className="w-full rounded-md bg-alea-600 px-3 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {address ? (busy ? "Confirming" : "Mint") : "Connect to mint"}
                </button>
            )}

            <p className="text-xs text-muted-foreground">
                Your signature fixes the seed. The piece is yours the moment it lands, and its
                image follows.
            </p>

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
