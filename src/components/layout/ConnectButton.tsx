"use client";

import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { shortAddress } from "@/lib/utils";
import { LogOut, Wallet } from "lucide-react";

export function ConnectButton() {
    const { address, connecting, restoring, connect, disconnect } = useWallet();

    if (restoring) return <div className="h-9 w-28" aria-hidden />;

    if (address) {
        return (
            <div className="inline-flex h-9 items-center rounded-md border border-border">
                {/* The address is the way to your own pieces, so it goes
                    somewhere. Disconnect is next to it rather than under it. */}
                <Link
                    href={`/wallet/${address}`}
                    title="What you own"
                    className="inline-flex h-full items-center gap-2 rounded-l-md px-3 text-sm font-medium transition-colors hover:bg-accent"
                >
                    <span className="h-2 w-2 rounded-full bg-success" />
                    {shortAddress(address)}
                </Link>
                <button
                    type="button"
                    onClick={() => void disconnect()}
                    title="Disconnect"
                    className="inline-flex h-full items-center rounded-r-md border-l border-border px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="sr-only">Disconnect</span>
                </button>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-alea-600 px-3 text-sm font-medium text-white transition-colors hover:bg-alea-700 disabled:opacity-60"
        >
            <Wallet className="h-4 w-4" />
            {connecting ? "Connecting" : "Connect"}
        </button>
    );
}
