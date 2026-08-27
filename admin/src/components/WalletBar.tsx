"use client";

import { useWallet } from "@/context/WalletContext";
import { shortAddress } from "@/lib/format";

export function WalletBar() {
    const { address, connecting, error, connect, disconnect } = useWallet();

    if (!address) {
        return (
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="btn"
                    onClick={() => void connect()}
                    disabled={connecting}
                >
                    {connecting ? "Connecting…" : "Connect"}
                </button>
                {error && <span className="text-xs text-bad">{error}</span>}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-3">
            <span className="font-mono text-sm">{shortAddress(address)}</span>
            <button type="button" className="btn" onClick={() => void disconnect()}>
                Disconnect
            </button>
        </div>
    );
}
