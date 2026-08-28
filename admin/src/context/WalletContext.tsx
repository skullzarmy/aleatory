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
 * The operator's own wallet.
 *
 * Much smaller than the public site's version of this, on purpose: there is
 * one user, they are here to sign administrative calls, and there is no
 * anonymous browsing path worth optimising for. The SDK still loads lazily,
 * because most visits to this console are to look at numbers.
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
 * Is this session on the network this console is pointed at?
 *
 * It matters more here than on the public site. Signing an administrative
 * call against the wrong chain does not simply fail: the same contract
 * addresses do not exist there, so the operation is rejected in a way that
 * reads as a broken deployment rather than a wrong network.
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
 * `IndexedDBStorage` starts `initDB()` in its constructor and assigns the
 * handle in a `.then`, so for the first moments `this.db` is undefined. Its
 * `transaction()` reads `this.db?.objectStoreNames.contains(name)`, which on
 * undefined rejects with "<name> not found" and blames a missing object store
 * for a database that has not opened yet.
 *
 * The client sends metrics on `requestPermissions`, and writes to that store
 * before the check for whether metrics are even enabled, so connecting fast
 * enough after load rejects a connection over a statistic nobody asked for.
 *
 * Retried rather than slept on: it usually passes on the first attempt, and
 * the bound means a genuinely broken IndexedDB costs a second, not a hang.
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
                // The connection is what matters, so ask the client whether it
                // has an account before reporting a failure. Some of what this
                // can reject with is bookkeeping the SDK does alongside the
                // permission request rather than the request itself.
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
