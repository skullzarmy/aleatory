"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";

/**
 * "What you own", for whoever is connected.
 *
 * A shortcut rather than a page: every address already has one at
 * `/wallet/{address}`, built from public chain state and shareable by anyone.
 * A second implementation of that view, gated on a connection, would show the
 * same pieces to one fewer person.
 */
export default function MinePage() {
    const router = useRouter();
    const { address, connecting, restoring, connect } = useWallet();

    useEffect(() => {
        if (address) router.replace(`/wallet/${address}`);
    }, [address, router]);

    if (address || restoring) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-16 text-sm text-muted-foreground">
                Opening your wallet page…
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-16">
            <h1 className="text-xl font-semibold tracking-tight">What you own</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Connect and this goes to your wallet page: the pieces you hold and the collections
                you made.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => void connect()}
                    disabled={connecting}
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {connecting ? "Connecting" : "Connect"}
                </button>
                <Link
                    href="/collections"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    Browse collections
                </Link>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
                Every address has a page here whether or not it ever connects. If you know one, it
                is at <code className="font-mono">/wallet/</code> followed by the address.
            </p>
        </div>
    );
}
