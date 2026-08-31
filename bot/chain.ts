/**
 * Where the contracts are, and how to read them.
 *
 * The bot's own copy. Nothing here imports from `src/`, because this runs on a
 * machine that has no site on it and has to keep working if the site is
 * deleted. The site's `lib/router.ts` answers the same question with Next's
 * caching wrapped around every fetch, which is the wrong shape for a process
 * that polls on its own clock.
 *
 * One address is configured, the router, and everything else is read from it.
 * That is what makes mainnet a change of two environment variables.
 */

export type Network = "shadownet" | "mainnet";

const TZKT: Record<Network, string> = {
    shadownet: "https://api.shadownet.tzkt.io",
    mainnet: "https://api.tzkt.io",
};

/**
 * Read when called, never at import.
 *
 * A module constant is evaluated the moment the module is first imported, and
 * an import is hoisted above every statement in the file that wrote it. So a
 * constant here would be filled from the environment before `dotenv.config()`
 * had run, and the process would start up reporting itself unconfigured while
 * `.env` sat there correctly filled in.
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
 * Read the router.
 *
 * `marketplaces` comes from storage history rather than from `set_marketplace`
 * events: the first marketplace is written at origination and emits nothing,
 * so an event scan silently loses it along with every fee it still holds.
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
        // The present still came from storage, so a failure here costs the
        // retired contracts and their unswept fees, not the whole reading.
        history = [];
    }

    return {
        factories: Array.isArray(s.factories) ? s.factories : [],
        marketplaces: [current, ...history.filter((m) => m !== current)].filter(Boolean),
        registry: s.registry ?? "",
        resolver: s.resolver ?? "",
    };
}
