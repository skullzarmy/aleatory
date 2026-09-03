import { CONTRACTS, tzktApi } from "./config";
import { indexerFetch } from "./tzkt";

/**
 * Where everything is, according to the chain.
 *
 * One address in the environment, the router, and the rest read from it, so a
 * redeploy cannot leave a running site pointing at a contract that is gone.
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
        const res = await indexerFetch(`${tzktApi()}/v1/contracts/${CONTRACTS.router}/storage`, {
            next: { revalidate: 60 },
        } as RequestInit);
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
            marketplaces: [current, ...previous.filter((m) => m !== current)].filter(Boolean),
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
        const res = await indexerFetch(
            `${tzktApi()}/v1/contracts/${CONTRACTS.router}/storage/history?limit=200`,
            { next: { revalidate: 300 } } as RequestInit,
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

/** Every factory, so a reader sees the whole catalog and not just the newest. */
export async function allFactories(): Promise<string[]> {
    return (await addresses()).factories;
}

/** Where a new listing or offer goes. */
export async function currentMarketplace(): Promise<string> {
    return (await addresses()).marketplaces[0] ?? "";
}

// ---------------------------------------------------------------------------
// Every contract the router has ever named
// ---------------------------------------------------------------------------

/** One contract, and when the router adopted it. */
export interface Held {
    address: string;
    /** Still the one in use. */
    current: boolean;
    /** When the router adopted it. Null for the ones it was originated with. */
    since: string | null;
    /** The operation that adopted it, for anyone checking. Null at origination. */
    op: string | null;
}

export interface Lineage {
    /** The one address in the environment. Everything else is read from it. */
    router: string;
    factories: Held[];
    marketplaces: Held[];
    registries: Held[];
    resolvers: Held[];
    /** True when the history was longer than we read, so the oldest are missing. */
    truncated: boolean;
}

interface HistoryRow {
    timestamp?: string;
    operation?: { hash?: string };
    value?: {
        factories?: string[];
        marketplace?: string;
        registry?: string;
        resolver?: string;
    };
}

const PAGE = 100;

/**
 * Every contract this router has pointed at, current and retired.
 *
 * Read from storage history, which carries each value a field has held and the
 * operation that put it there. Events would miss everything set at
 * origination, which is the first of all four.
 *
 * A retired contract is still a real contract: collections a retired factory
 * made are owned by real artists, and a retired marketplace still holds the
 * listings and escrowed offers made on it. Publishing the whole list is what
 * lets anyone check that claim rather than take it.
 */
export async function lineage(): Promise<Lineage> {
    const router = CONTRACTS.router;
    const empty: Lineage = {
        router,
        factories: [],
        marketplaces: [],
        registries: [],
        resolvers: [],
        truncated: false,
    };
    if (!router) return empty;

    const rows: HistoryRow[] = [];
    let truncated = false;
    for (let offset = 0; ; offset += PAGE) {
        const res = await indexerFetch(
            `${tzktApi()}/v1/contracts/${router}/storage/history?limit=${PAGE}&offset=${offset}`,
        );
        if (!res.ok) return offset === 0 ? empty : finish(rows, router, true);
        const page = (await res.json()) as HistoryRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
        // Ten pages is a thousand administrative operations. Past that the page
        // says the tail is missing instead of scrolling the chain forever.
        if (rows.length >= 10 * PAGE) {
            truncated = true;
            break;
        }
    }
    return finish(rows, router, truncated);
}

/**
 * Turn newest-first storage snapshots into an adoption order.
 *
 * Walked oldest first, so the moment a field's value differs from the one
 * before it, that row is when the new one was adopted. The oldest row carries
 * whatever the router was originated with, which has no adopting operation.
 */
function finish(rows: HistoryRow[], router: string, truncated: boolean): Lineage {
    const oldestFirst = [...rows].reverse();

    const single = (pick: (v: NonNullable<HistoryRow["value"]>) => string | undefined): Held[] => {
        const held: Held[] = [];
        for (const [i, row] of oldestFirst.entries()) {
            const address = row.value ? pick(row.value) : undefined;
            if (!address || address === held[held.length - 1]?.address) continue;
            held.push({
                address,
                current: false,
                since: i === 0 ? null : (row.timestamp ?? null),
                op: i === 0 ? null : (row.operation?.hash ?? null),
            });
        }
        return mark(held);
    };

    // A factory is consed on, so each row's head is the one that row added.
    const factories: Held[] = [];
    for (const [i, row] of oldestFirst.entries()) {
        for (const address of row.value?.factories ?? []) {
            if (factories.some((f) => f.address === address)) continue;
            factories.push({
                address,
                current: false,
                since: i === 0 ? null : (row.timestamp ?? null),
                op: i === 0 ? null : (row.operation?.hash ?? null),
            });
        }
    }

    return {
        router,
        factories: mark(factories),
        marketplaces: single((v) => v.marketplace),
        registries: single((v) => v.registry),
        resolvers: single((v) => v.resolver),
        truncated,
    };
}

/** Newest first, with the head marked as the one in use. */
function mark(held: Held[]): Held[] {
    const newestFirst = [...held].reverse();
    return newestFirst.map((h, i) => ({ ...h, current: i === 0 }));
}
