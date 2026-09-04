"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchPiece } from "@/lib/piece";
import { shortAddress } from "@/lib/utils";

/**
 * A piece that exists on chain and has not reached the indexer yet.
 *
 * The contract has already said this token id was minted, so the piece is real
 * and this page is its address. What is missing is the operation hash, which is
 * the seed, and until an indexer has it there is nothing to draw: the seed is
 * what makes this piece this piece rather than any other from the generator.
 *
 * So it waits, and says what it is waiting for. Drawing something in the
 * meantime would mean drawing a different piece and calling it theirs.
 */
export function PieceArriving({ contract, tokenId }: { contract: string; tokenId: string }) {
    const router = useRouter();
    const [waited, setWaited] = useState(0);

    useEffect(() => {
        let stop = false;
        const id = window.setInterval(() => {
            setWaited((n) => n + 1);
            void fetchPiece(contract, tokenId)
                .then((piece) => {
                    // A seed is the point of arriving: the server can render
                    // the real piece the moment there is one.
                    if (!stop && piece?.seed) router.refresh();
                })
                .catch(() => {});
        }, 4000);
        return () => {
            stop = true;
            window.clearInterval(id);
        };
    }, [contract, tokenId, router]);

    return (
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Your piece is on chain</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                The contract has it. The seed comes from the operation that minted it, and an
                indexer has not read that yet, so there is nothing to draw for another moment.
                Nothing is wrong and nothing is lost: this page is where it lives, from now on.
            </p>
            <p className="mt-6 text-sm text-muted-foreground" role="status" aria-live="polite">
                Waiting for the chain to be read{".".repeat((waited % 3) + 1)}
            </p>
            <p className="mt-8 font-mono text-xs text-muted-foreground">
                {shortAddress(contract)} #{Number(tokenId) + 1}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link
                    href={`/collection/${contract}`}
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    The collection
                </Link>
                <Link
                    href="/mine"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    What you own
                </Link>
            </div>
        </div>
    );
}
