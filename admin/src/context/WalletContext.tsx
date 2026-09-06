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
import { BRAND, NETWORK, RPC_URL } from "@/lib/config";

/**
 * The operator's own wallet. Smaller than the public site's: one user, here to
 * sign administrative calls. The SDK still loads lazily, because most visits
 * are to look at numbers.
 */
type SDKModule = typeof import("@tezos-x/octez.connect-sdk");

let sdkPromise: Promise<SDKModule> | null = null;
function loadSDK(): Promise<SDKModule> {
    if (!sdkPromise) sdkPromise = import("@tezos-x/octez.connect-sdk");
    return sdkPromise;
}

function buildNetwork(sdk: SDKModule) {
    if (NETWORK === "mainnet") return { type: sdk.NetworkType.MAINNET };
    return {
        type: sdk.NetworkType.CUSTOM,
        name: NETWORK.charAt(0).toUpperCase() + NETWORK.slice(1),
        rpcUrl: RPC_URL[NETWORK],
    };
}

let client: DAppClient | null = null;
let onActiveAccount: ((address: string | null) => void) | null = null;

/**
 * Is this session on the network this console is pointed at? The contract
 * addresses do not exist on another chain, so signing there is rejected in a
 * way that reads as a broken deployment.
 */
function matchesNetwork(
    account: { network?: { type?: string; rpcUrl?: string } } | null,
): boolean {
    if (!account?.network) return false;
    const want = NETWORK === "mainnet" ? "mainnet" : "custom";
    if ((account.network.type ?? "").toLowerCase() !== want) return false;
    if (want === "custom") {
        const theirs = (account.network.rpcUrl ?? "").replace(/\/+$/, "");
        if (theirs !== RPC_URL[NETWORK].replace(/\/+$/, "")) return false;
    }
    return true;
}

/**
 * Wait for the SDK's own IndexedDB to finish opening.
 *
 * `IndexedDBStorage` assigns its handle in a `.then`, so for the first moments
 * `this.db` is undefined and `transaction()` rejects with "<name> not found",
 * blaming a missing object store for a database that has not opened. The client
 * writes metrics on `requestPermissions` before checking whether metrics are
 * enabled, so connecting fast enough after load fails over a statistic nobody
 * asked for.
 *
 * Retried, not slept on: it usually passes first time, and the bound means a
 * broken IndexedDB costs a second.
 */
async function warmStorage(c: DAppClient): Promise<void> {
    const store = (c as unknown as { beaconIDB?: { getAllKeys?: (s: string) => Promise<unknown> } })
        .beaconIDB;
    if (!store?.getAllKeys) return;
    for (let i = 0; i < 20; i++) {
        try {
            await store.getAllKeys("metrics");
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 50));
        }
    }
}

async function getClient(): Promise<DAppClient> {
    if (client) return client;
    const sdk = await loadSDK();
    client = new sdk.DAppClient({ name: BRAND.name, network: buildNetwork(sdk) });
    await client.subscribeToEvent(sdk.BeaconEvent.ACTIVE_ACCOUNT_SET, (account) => {
        onActiveAccount?.(account && matchesNetwork(account) ? account.address : null);
    });
    await warmStorage(client);
    return client;
}

interface WalletState {
    address: string | null;
    connecting: boolean;
    error: string | null;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    getClient: () => Promise<DAppClient>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
    const [address, setAddress] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        onActiveAccount = setAddress;
        return () => {
            onActiveAccount = null;
        };
    }, []);

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
        if (!hasSession) return;

        void (async () => {
            try {
                const c = await getClient();
                const account = await c.getActiveAccount();
                if (!cancelled && account && matchesNetwork(account)) {
                    setAddress(account.address);
                }
            } catch {
                /* a broken session behaves as no session */
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
            if (existing && matchesNetwork(existing)) {
                setAddress(existing.address);
                return;
            }
            const sdk = await loadSDK();
            try {
                await c.requestPermissions({
                    scopes: [sdk.PermissionScope.OPERATION_REQUEST],
                });
            } catch (e) {
                // Some of what this rejects with is bookkeeping the SDK does
                // alongside the request, so ask whether an account arrived.
                const account = await c.getActiveAccount().catch(() => null);
                if (!account) throw e;
            }
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
            /* already gone */
        }
        setAddress(null);
    }, []);

    const value = useMemo<WalletState>(
        () => ({ address, connecting, error, connect, disconnect, getClient }),
        [address, connecting, error, connect, disconnect],
    );

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
    return ctx;
}
