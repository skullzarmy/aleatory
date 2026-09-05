/**
 * Where the contracts are, and how to read them. The bot's own copy: nothing
 * here imports from `src/`, because this runs on a machine with no site on it,
 * and `lib/router.ts` wraps Next's caching around every fetch.
 *
 * One address is configured, the router, and everything else is read from it.
 */

export type Network = "shadownet" | "mainnet";

const TZKT: Record<Network, string> = {
    shadownet: "https://api.shadownet.tzkt.io",
    mainnet: "https://api.tzkt.io",
};

/**
 * Read when called, never at import. Imports are hoisted above the
 * `dotenv.config()` that fills the environment, so a module constant here reads
 * an empty `.env` and the process starts up reporting itself unconfigured.
 */
export const network = (): Network =>
    (process.env.ALEA_NETWORK as Network) ||
    (process.env.NEXT_PUBLIC_TEZOS_NETWORK as Network) ||
    "shadownet";

export const tzktApi = () => process.env.TZKT_API || TZKT[network()];

export const router = () =>
    process.env.ALEA_ROUTER_ADDRESS || process.env.NEXT_PUBLIC_ROUTER_ADDRESS || "";

/** Ours. The router names the registry, and the registry lists every provider. */
export const provider = () => process.env.ALEA_PROVIDER_ADDRESS || "";

export async function tzkt<T>(path: string): Promise<T> {
    const res = await fetch(`${tzktApi()}${path}`);
    if (!res.ok) throw new Error(`${path.split("?")[0]} answered ${res.status}`);
    return (await res.json()) as T;
}

export interface Addresses {
    /** Newest first. Nothing is ever removed, so a retired one is still here. */
    factories: string[];
    /** Every marketplace the router has ever held, newest first. */
    marketplaces: string[];
    registry: string;
    resolver: string;
}

/**
 * Read the router. `marketplaces` comes from storage history, because the first
 * marketplace is written at origination and emits nothing, so an event scan
 * loses it along with every fee it still holds.
 */
export async function addresses(): Promise<Addresses> {
    const ROUTER = router();
    if (!ROUTER) throw new Error("ALEA_ROUTER_ADDRESS is not set");

    const s = await tzkt<{
        factories?: string[];
        marketplace?: string;
        registry?: string;
        resolver?: string;
    }>(`/v1/contracts/${ROUTER}/storage`);

    const current = s.marketplace ?? "";
    let history: string[] = [];
    try {
        const rows = await tzkt<{ value?: { marketplace?: string } }[]>(
            `/v1/contracts/${ROUTER}/storage/history?limit=200`,
        );
        for (const row of rows) {
            const address = row?.value?.marketplace;
            if (address && !history.includes(address)) history.push(address);
        }
    } catch {
        // The present came from storage, so this costs the retired contracts
        // and their unswept fees, not the whole reading.
        history = [];
    }

    return {
        factories: Array.isArray(s.factories) ? s.factories : [],
        marketplaces: [current, ...history.filter((m) => m !== current)].filter(Boolean),
        registry: s.registry ?? "",
        resolver: s.resolver ?? "",
    };
}
