"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { acceptCollaboration } from "@/lib/ops";
import type { Collab } from "@/lib/collab";

/**
 * Shown to somebody named as a collaborator who has not accepted yet.
 *
 * Their share is already being paid out of every mint. What this signs for is
 * the credit: until they do, the page counts them without naming them, so
 * nobody else's name ends up on a generator they had nothing to do with.
 */
export function AcceptCredit({ generator, collab }: { generator: string; collab: Collab }) {
    const { address, getClient } = useWallet();
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const named = address ? collab.shares.some((s) => s.address === address) : false;
    const confirmed = address ? collab.confirmed.includes(address) : false;
    if (!named || confirmed) return null;

    const share = collab.shares.find((s) => s.address === address);

    async function accept() {
        setBusy(true);
        setError(null);
        try {
            await acceptCollaboration(await getClient(), generator);
            setDone(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : "The wallet refused it.");
        } finally {
            setBusy(false);
        }
    }

    if (done) {
        return (
            <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
                Accepted. Your name appears here once the indexer catches up.
            </p>
        );
    }

    return (
        <div className="space-y-2 rounded-md border border-alea-600/40 bg-alea-600/10 px-3 py-3">
            <p className="text-sm font-medium">You are a collaborator on this generator</p>
            <p className="text-xs text-muted-foreground">
                {share
                    ? `You receive ${(share.bps / 100).toFixed(2)}% of every mint, which is already the case. `
                    : ""}
                Accept to be credited as one of its artists, here and in each piece published from
                now on.
            </p>
            <button
                type="button"
                disabled={busy}
                onClick={() => void accept()}
                className="rounded-md bg-alea-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
            >
                {busy ? "Signing…" : "Accept credit"}
            </button>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
