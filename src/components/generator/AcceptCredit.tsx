"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { acceptCollaboration } from "@/lib/ops";
import type { Collab } from "@/lib/collab";

/**
 * Shown to an artist who has not accepted being credited yet.
 *
 * Gated on `creditable` and not on `shares`, which are different lists: a
 * studio taking a cut is paid and would have this call reverted by the
 * contract, and an artist who waived their share has nothing in `shares` to
 * be found by. What this signs for is the credit alone, and until then the
 * page counts them without naming them.
 */
export function AcceptCredit({ generator, collab }: { generator: string; collab: Collab }) {
    const { address, getClient } = useWallet();
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const invited = address ? collab.creditable.includes(address) : false;
    const confirmed = address ? collab.confirmed.includes(address) : false;
    if (!invited || confirmed) return null;

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
            <p className="text-sm font-medium">You are named as an artist on this generator</p>
            <p className="text-xs text-muted-foreground">
                {share
                    ? `You receive ${(share.bps / 100).toFixed(2)}% of every mint, which is already the case. `
                    : "You take no share of the mint. "}
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
