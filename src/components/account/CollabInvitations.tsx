"use client";

import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { shortAddress } from "@/lib/utils";

/**
 * Generators somebody named this wallet on that it has not accepted yet.
 *
 * Only the person whose page it is sees this, the same rule `ProfileNudge`
 * follows. They are already being paid their share of every mint; what is
 * waiting is whether their name goes on the work, which only they can say.
 * Accepting happens on the generator's own page, next to the piece.
 */
export function CollabInvitations({
    address,
    invitations,
}: {
    address: string;
    invitations: { address: string; name?: string }[];
}) {
    const { address: viewer } = useWallet();
    if (viewer !== address || invitations.length === 0) return null;

    return (
        <div className="mt-4 space-y-2 rounded-md border border-alea-600/40 bg-alea-600/10 px-3 py-3">
            <p className="text-sm font-medium">
                {invitations.length === 1
                    ? "You are named as a collaborator on a generator"
                    : `You are named as a collaborator on ${invitations.length} generators`}
            </p>
            <p className="text-xs text-muted-foreground">
                Your share of every mint is already being paid. Accept to be credited as one of the
                artists.
            </p>
            <ul className="space-y-1">
                {invitations.map((g) => (
                    <li key={g.address}>
                        <Link
                            href={`/generator/${g.address}`}
                            className="text-sm font-medium underline hover:text-foreground"
                        >
                            {g.name || shortAddress(g.address)}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
