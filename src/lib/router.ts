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
    marketplace: string;
    registry: string;
    resolver: string;
}

const EMPTY: Addresses = { factories: [], marketplace: "", registry: "", resolver: "" };

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
        return {
            factories: Array.isArray(s.factories) ? s.factories : [],
            marketplace: s.marketplace ?? "",
            registry: s.registry ?? "",
            resolver: s.resolver ?? "",
        };
    } catch {
        return EMPTY;
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
        marketplace: CONTRACTS.marketplace || chain.marketplace,
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
