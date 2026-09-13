import { CONTRACTS, tzktApi } from "./config";
import { indexerFetch } from "./tzkt";

/**
 * Where everything is, according to the chain. One address in the environment,
 * the router, and the rest read from it, so a redeploy cannot leave a running
 * site pointing at a contract that is gone.
 *
 * Both lists hold every address the router has ever named, newest first. A
 * retired factory's generators are still owned by real artists, and a retired
 * marketplace still holds live listings and escrowed offers.
 *
 * The environment wins where it names something, so a fork can point at its own
 * contracts without deploying a router.
 */
export interface Addresses {
    /** Newest first. The head is where a deploy goes. */
    factories: string[];
    /** Newest first. The router stores only the current one; the rest are history. */
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
 * Read the router's storage. The on-chain view carries the same values and
 * needs an RPC round trip per call, and this is on the path of every page.
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
 * From storage history, which carries each value a field has held however it
 * got there. The first marketplace is written at origination and emits nothing,
 * so an event scan loses it along with every listing and offer on it.
 *
 * A failure here costs the history and not the present.
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

    // An env address goes to the front of its list and does not replace it, or
    // overriding one would hide every generator the others made.
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

/** Where a new generator is deployed. */
export async function currentFactory(): Promise<string> {
    return (await addresses()).factories[0] ?? "";
}

/** Every factory, so a reader sees the whole catalog. */
export async function allFactories(): Promise<string[]> {
    return (await addresses()).factories;
}

/** Where a new listing or offer goes. */
export async function currentMarketplace(): Promise<string> {
    return (await addresses()).marketplaces[0] ?? "";
}

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
 * Every contract this router has pointed at, current and retired, from storage
 * history, which carries each value a field has held and the operation that put
 * it there. Events would miss everything set at origination, which is the first
 * of all four.
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
 * Turn newest-first storage snapshots into an adoption order. Walked oldest
 * first, so a row where a field differs from the row before it is when that
 * value was adopted. The oldest row is what the router was originated with and
 * has no adopting operation.
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
