import { CONTRACTS, tzktApi } from "./config";

/**
 * Where everything is, according to the chain.
 *
 * One address in the environment, the router, and the rest read from it. The
 * addresses used to live in `.env`, which meant every reader had to be told
 * them out of band and a redeploy pointed a running site at a contract that no
 * longer existed. That happened three times in one day here, and each time the
 * site quietly showed nothing rather than saying anything.
 *
 * **`factories` is every factory there has ever been, newest first.** A
 * redeploy adds one, it does not replace the list, because collections a
 * retired factory originated are still real collections owned by real artists.
 * A reader that only looked at the newest would drop them off the site.
 *
 * The environment still wins when it names something, so a fork can point at
 * its own contracts without deploying a router, and local development can
 * override one address without touching the chain.
 */
export interface Addresses {
    /** Newest first. The head is where a deploy goes. */
    factories: string[];
    /**
     * Every marketplace there has ever been, newest first.
     *
     * The router stores one, the current one, and emits `set_marketplace`
     * whenever it changes, so the rest are recovered from those events. A
     * reader that only looked at the current address would drop every live
     * listing and every escrowed offer the moment a new marketplace shipped,
     * and the tez behind an offer would look lost to whoever placed it.
     */
    marketplaces: string[];
    registry: string;
    resolver: string;
}

const EMPTY: Addresses = {
    factories: [],
    marketplaces: [],
    registry: "",
    resolver: "",
};

let cached: { at: number; value: Addresses } | null = null;
const TTL_MS = 60_000;

/**
 * Read the router's storage.
 *
 * Storage rather than the on-chain view, because a view needs an RPC round
 * trip per call and this is on the path of every page. The values are the
 * same; the view exists for other contracts.
 */
async function fromChain(): Promise<Addresses> {
    if (!CONTRACTS.router) return EMPTY;
    try {
        const res = await fetch(`${tzktApi()}/v1/contracts/${CONTRACTS.router}/storage`, {
            next: { revalidate: 60 },
        });
        if (!res.ok) return EMPTY;
        const s = (await res.json()) as {
            factories?: string[];
            marketplace?: string;
            registry?: string;
            resolver?: string;
        };
        const current = s.marketplace ?? "";
        const previous = await marketplaceHistory();

        return {
            factories: Array.isArray(s.factories) ? s.factories : [],
            marketplaces: [current, ...previous.filter((m) => m !== current)].filter(
                Boolean,
            ),
            registry: s.registry ?? "",
            resolver: s.resolver ?? "",
        };
    } catch {
        return EMPTY;
    }
}

/**
 * Every marketplace the router has ever held, newest first.
 *
 * From the storage history rather than from `set_marketplace` events. The
 * first marketplace is written at origination and emits nothing, so an event
 * scan silently loses it, along with every listing and escrowed offer on it.
 * Storage history has each value the field has held, however it got there.
 *
 * A failure here costs the history and not the present: the current address
 * still comes from storage, so the site works and only old listings go
 * missing.
 */
async function marketplaceHistory(): Promise<string[]> {
    try {
        const res = await fetch(
            `${tzktApi()}/v1/contracts/${CONTRACTS.router}/storage/history?limit=200`,
            { next: { revalidate: 300 } },
        );
        if (!res.ok) return [];
        const rows = (await res.json()) as { value?: { marketplace?: string } }[];
        const seen: string[] = [];
        for (const row of rows) {
            const address = row?.value?.marketplace;
            if (address && !seen.includes(address)) seen.push(address);
        }
        return seen;
    } catch {
        return [];
    }
}

export async function addresses(): Promise<Addresses> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

    const chain = await fromChain();

    // The environment overrides, so a fork or a local run can point at its own
    // contracts without a router. An env factory is added to the front rather
    // than replacing the list, or overriding one address would hide every
    // collection the others made.
    const envFactory = CONTRACTS.factory;
    const value: Addresses = {
        factories: envFactory
            ? [envFactory, ...chain.factories.filter((f) => f !== envFactory)]
            : chain.factories,
        marketplaces: CONTRACTS.marketplace
            ? [
                  CONTRACTS.marketplace,
                  ...chain.marketplaces.filter((m) => m !== CONTRACTS.marketplace),
              ]
            : chain.marketplaces,
        registry: CONTRACTS.registry || chain.registry,
        resolver: CONTRACTS.resolver || chain.resolver,
    };

    cached = { at: Date.now(), value };
    return value;
}

/** Where a new collection is deployed. */
export async function currentFactory(): Promise<string> {
    return (await addresses()).factories[0] ?? "";
}

/** Every factory, so a reader sees the whole catalogue and not just the newest. */
export async function allFactories(): Promise<string[]> {
    return (await addresses()).factories;
}

/** Where a new listing or offer goes. */
export async function currentMarketplace(): Promise<string> {
    return (await addresses()).marketplaces[0] ?? "";
}
