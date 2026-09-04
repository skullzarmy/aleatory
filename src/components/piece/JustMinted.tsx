"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * The moment after a mint, on the piece's own page.
 *
 * A collector has just signed for something nobody has seen. That is worth
 * saying, and it was worth a whole second page until this one could hold a
 * piece the indexer had not caught up with. Two pages meant the celebration and
 * the permanent record drifted apart: one of them showed the collector's chosen
 * parameters and the other showed a plausible set of defaults.
 *
 * Marked by `?minted` on the way in from the mint, so a link somebody shares
 * later is the plain page and nobody else is congratulated for a purchase that
 * was not theirs.
 */
export function JustMinted({
    contract,
    remaining,
}: {
    contract: string;
    /** Unsold in the edition, or null for an open one. */
    remaining: number | null;
}) {
    const params = useSearchParams();
    if (!params.has("minted")) return null;

    return (
        <div className="mb-6 rounded-lg border border-alea-600/40 bg-alea-600/5 px-4 py-3">
            <p className="text-sm font-medium text-alea-600">It&apos;s yours</p>
            <p className="mt-1 text-sm text-muted-foreground">
                Nobody has seen this before. It is drawn from the generator in the contract and the
                seed your signature just fixed, and this page is where it lives from now on.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
                {remaining !== 0 && (
                    <Link
                        href={`/collection/${contract}`}
                        className="rounded-md bg-alea-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-alea-700"
                    >
                        Mint another
                        {remaining !== null && ` (${remaining} remaining)`}
                    </Link>
                )}
                <Link
                    href="/mine"
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                >
                    What you own
                </Link>
                <Link
                    href="/collections"
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                >
                    Other collections
                </Link>
            </div>
        </div>
    );
}
