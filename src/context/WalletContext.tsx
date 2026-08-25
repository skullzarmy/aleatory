"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import type { DAppClient } from "@tezos-x/octez.connect-sdk";
import { BRAND, NETWORK } from "@/lib/config";

/**
 * Wallet connection, on Tezos X Connect.
 *
 * The SDK is around two megabytes, so it loads on first use. A visitor
 * browsing the feed never downloads it.
 */
type SDKModule = typeof import("@tezos-x/octez.connect-sdk");

let sdkPromise: Promise<SDKModule> | null = null;
function loadSDK(): Promise<SDKModule> {
    if (!sdkPromise) sdkPromise = import("@tezos-x/octez.connect-sdk");
    return sdkPromise;
}

const RPC: Record<string, string> = {
    shadownet: "https://rpc.tzkt.io/shadownet",
    mainnet: "https://rpc.tzkt.io/mainnet",
};

function buildNetwork(sdk: SDKModule) {
    if (NETWORK === "mainnet") return { type: sdk.NetworkType.MAINNET };
    return {
        type: sdk.NetworkType.CUSTOM,
        name: NETWORK.charAt(0).toUpperCase() + NETWORK.slice(1),
        rpcUrl: RPC[NETWORK],
    };
}

let client: DAppClient | null = null;
async function getClient(): Promise<DAppClient> {
    if (client) return client;
    const sdk = await loadSDK();
    client = new sdk.DAppClient({ name: BRAND.name, network: buildNetwork(sdk) });
    return client;
}

interface WalletState {
    address: string | null;
    connecting: boolean;
    /** True while a previous session is being restored on mount. */
    restoring: boolean;
    error: string | null;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    /** The connected client, for sending operations. */
    getClient: () => Promise<DAppClient>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
    const [address, setAddress] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [restoring, setRestoring] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Restore a session only when one exists, so the SDK stays unloaded for
    // visitors who have never connected.
    useEffect(() => {
        let cancelled = false;
        const hasSession = (() => {
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    if (localStorage.key(i)?.startsWith("beacon:")) return true;
                }
            } catch {
                /* storage blocked */
            }
            return false;
        })();

        if (!hasSession) {
            setRestoring(false);
            return;
        }

        void (async () => {
            try {
                const c = await getClient();
                const account = await c.getActiveAccount();
                if (!cancelled) setAddress(account?.address ?? null);
            } catch {
                /* a broken session behaves as no session */
            } finally {
                if (!cancelled) setRestoring(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const connect = useCallback(async () => {
        setConnecting(true);
        setError(null);
        try {
            const c = await getClient();
            const existing = await c.getActiveAccount();
            if (existing) {
                setAddress(existing.address);
                return;
            }
            const sdk = await loadSDK();
            await c.requestPermissions({
                scopes: [sdk.PermissionScope.OPERATION_REQUEST],
            });
            const account = await c.getActiveAccount();
            setAddress(account?.address ?? null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not connect");
        } finally {
            setConnecting(false);
        }
    }, []);

    const disconnect = useCallback(async () => {
        try {
            const c = await getClient();
            await c.clearActiveAccount();
        } catch {
            /* clearing a session that is already gone is fine */
        }
        setAddress(null);
    }, []);

    const value = useMemo<WalletState>(
        () => ({ address, connecting, restoring, error, connect, disconnect, getClient }),
        [address, connecting, restoring, error, connect, disconnect],
    );

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
    return ctx;
}
