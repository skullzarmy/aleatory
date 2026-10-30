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
 * Wallet connection, on Tezos X Connect. The SDK is around two megabytes, so it
 * loads on first use and a visitor browsing the feed never downloads it.
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

/**
 * The network handed to the SDK, named by the SDK's own `NetworkType` for the
 * chain. The connect dialog looks a web wallet's address up as
 * `links[network.type]`, and no wallet publishes a `custom` entry, so CUSTOM
 * resolves to `links.mainnet` and sends a shadownet visitor to
 * wallet.kukai.app.
 *
 * The values are the same strings as ours, "shadownet" and "mainnet", which is
 * what `matchesNetwork` below compares against.
 */
function buildNetwork(sdk: SDKModule) {
    return {
        type: NETWORK === "mainnet" ? sdk.NetworkType.MAINNET : sdk.NetworkType.SHADOWNET,
        rpcUrl: RPC[NETWORK],
    };
}

/**
 * Which wallets fill the four slots the dialog offers before "Show more", on
 * shadownet. The SDK defaults to ["kukai", "temple", "plenty", "umami"], and
 * no wallet in the registry has a key beginning "plenty", so that slot falls
 * through to the first of the remainder in alphabetical order, which is
 * AirGap. AirGap resolves no network configuration for shadownet, so a
 * visitor who picks it reaches a wallet that cannot complete the connection.
 * Naming a fourth wallet that works there leaves AirGap reachable under "Show
 * more". Mainnet is a network every wallet in the registry resolves, so there
 * the SDK's own default stands and AirGap gets one of the four slots back.
 */
const FEATURED_WALLETS =
    NETWORK === "mainnet" ? undefined : ["kukai", "temple", "umami", "metamask"];

/**
 * The in-flight build, not just the built client: two callers racing
 * `getClient()` before either's `await` resolves both see no client yet and
 * each construct their own, which is what the SDK's own "multiple Client
 * instances" warning was catching. Caching the promise itself, the same way
 * `src/lib/identity.ts` dedupes concurrent lookups, means the second caller
 * awaits the first's construction instead of starting a second one.
 */
let clientPromise: Promise<DAppClient> | null = null;

/**
 * Where an account change is delivered, set by the provider on mount. Module
 * level, because the subscription belongs to the client and outlives a render.
 */
let onActiveAccount: ((address: string | null) => void) | null = null;

async function getClient(): Promise<DAppClient> {
    if (!clientPromise) {
        clientPromise = buildClient().catch((e) => {
            clientPromise = null;
            throw e;
        });
    }
    return clientPromise;
}

async function buildClient(): Promise<DAppClient> {
    const sdk = await loadSDK();
    const c = new sdk.DAppClient({
        name: BRAND.name,
        description: BRAND.description,
        iconUrl: `${BRAND.url}/web-app-manifest-192x192.png`,
        appUrl: BRAND.url,
        network: buildNetwork(sdk),
        featuredWallets: FEATURED_WALLETS,
    });

    // WalletConnectTransport's default `isSessionValid` sends a live WebSocket
    // `signClient.ping` to the wallet during `init()` and disconnects the
    // session when the ping fails. On mobile the wallet app is suspended in the
    // background until `tryToAppSwitch()` foregrounds it, and rapid refreshes
    // abort in-flight pings, causing the SDK to tear down valid sessions.
    const internal = c as unknown as {
        initInternalTransports?: () => Promise<void>;
        activeAccountLoaded?: Promise<unknown>;
        walletConnectTransport?: {
            client?: {
                isSessionValid?: (s?: { expiry?: number }) => Promise<boolean>;
            };
        };
    };
    const origInitTransports = internal.initInternalTransports;
    if (typeof origInitTransports === "function") {
        internal.initInternalTransports = async function (this: typeof internal) {
            await origInitTransports.call(this);
            const wcClient = this.walletConnectTransport?.client;
            if (wcClient) {
                wcClient.isSessionValid = async (session) =>
                    Boolean(session?.expiry && session.expiry > Math.floor(Date.now() / 1000));
            }
        };
    }

    // The wallet can change the active account without being asked, and nothing
    // here polls, so without this the page shows the old account until reload.
    await c.subscribeToEvent(sdk.BeaconEvent.ACTIVE_ACCOUNT_SET, (account) => {
        const next = account && matchesNetwork(account) ? account.address : null;
        onActiveAccount?.(next);
    });

    await internal.activeAccountLoaded?.catch(() => {});

    return c;
}

function clearStoredSession(): void {
    try {
        const drop: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith("beacon:") || k.startsWith("wc@2:"))) drop.push(k);
        }
        for (const k of drop) localStorage.removeItem(k);
    } catch {
        /* storage blocked */
    }
}

/**
 * Drop a session and start over with a clean client. Clearing the active
 * account leaves the transport and peer behind, so the next request talks to a
 * dead link and falls back to the P2P relay, which answers "no server
 * responded" instead of opening the extension.
 */
async function resetClient(c: DAppClient): Promise<void> {
    try {
        await c.clearActiveAccount();
    } catch {
        /* already gone */
    }
    try {
        await (c as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
        /* older SDKs have no destroy */
    }
    clearStoredSession();
    clientPromise = null;
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

/**
 * Does this session belong to the network this site is configured for? A
 * session whose network does not match is treated as no session.
 *
 * Beacon stores permissions per origin, and in development every app on the
 * machine is `localhost`, so another dApp's session is found and reused here,
 * network and all. The symptom is `non_existing_contract` for a contract that
 * exists on the other chain, and the other dApp's name on the confirm screen.
 */
function matchesNetwork(account: { network?: { type?: string } } | null): boolean {
    if (!account?.network) return false;
    // The named type identifies the chain on its own, so the RPC is not
    // compared: a wallet is free to report the node it actually used.
    return (account.network.type ?? "").toLowerCase() === NETWORK;
}

interface StoredAccount {
    accountIdentifier?: string;
    address?: string;
    network?: { type?: string };
}

/**
 * Read the persisted account directly from localStorage on mount so page
 * refreshes do not boot DAppClient or open and tear down WalletConnect relay
 * sockets before the visitor asks to sign.
 */
function readStoredAccount(): StoredAccount | null {
    try {
        const rawActive = localStorage.getItem("beacon:active-account");
        if (!rawActive || rawActive === "undefined") return null;
        let activeId = rawActive;
        try {
            const parsed: unknown = JSON.parse(rawActive);
            if (typeof parsed === "string") activeId = parsed;
        } catch {
            /* plain string */
        }
        if (!activeId) return null;

        const rawAccounts = localStorage.getItem("beacon:accounts");
        if (!rawAccounts) return null;
        const accounts: unknown = JSON.parse(rawAccounts);
        if (!Array.isArray(accounts)) return null;
        return (accounts as StoredAccount[]).find((a) => a?.accountIdentifier === activeId) ?? null;
    } catch {
        return null;
    }
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
    const [address, setAddress] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [restoring, setRestoring] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Registered before the restore below, so the event restore triggers has
    // somewhere to land.
    useEffect(() => {
        onActiveAccount = setAddress;
        return () => {
            onActiveAccount = null;
        };
    }, []);

    // Restore from localStorage without booting the SDK or opening a relay
    // socket on every page load.
    useEffect(() => {
        const syncFromStorage = () => {
            const account = readStoredAccount();
            if (!account) {
                setAddress(null);
                setRestoring(false);
                return;
            }
            if (!matchesNetwork(account)) {
                clearStoredSession();
                setAddress(null);
                setRestoring(false);
                return;
            }
            setAddress(account.address ?? null);
            setRestoring(false);
        };

        syncFromStorage();

        const onStorage = (e: StorageEvent) => {
            if (!e.key || e.key === "beacon:active-account" || e.key === "beacon:accounts") {
                syncFromStorage();
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
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
            let active = c;
            if (existing) {
                // Connected to the wrong chain, so ask again.
                await resetClient(c);
                active = await getClient();
            }
            const sdk = await loadSDK();
            await active.requestPermissions({
                scopes: [sdk.PermissionScope.OPERATION_REQUEST],
            });
            const account = await active.getActiveAccount();
            setAddress(account?.address ?? null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not connect");
        } finally {
            setConnecting(false);
        }
    }, []);

    const disconnect = useCallback(async () => {
        try {
            if (clientPromise) {
                const c = await clientPromise;
                await resetClient(c);
            } else {
                clearStoredSession();
            }
        } catch {
            clearStoredSession();
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
