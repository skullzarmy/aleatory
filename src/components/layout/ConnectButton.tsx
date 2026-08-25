"use client";

import { useWallet } from "@/context/WalletContext";
import { shortAddress } from "@/lib/utils";
import { Wallet } from "lucide-react";

export function ConnectButton() {
    const { address, connecting, restoring, connect, disconnect } = useWallet();

    if (restoring) return <div className="h-9 w-28" aria-hidden />;

    if (address) {
        return (
            <button
                type="button"
                onClick={() => void disconnect()}
                title="Disconnect"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
            >
                <span className="h-2 w-2 rounded-full bg-success" />
                {shortAddress(address)}
            </button>
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
