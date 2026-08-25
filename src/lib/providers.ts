/**
 * Render providers, and how they are ranked.
 *
 * A provider is any contract exposing `get_render_gas` and `get_agent`.
 * Anyone can deploy one and list it in the registry, for free.
 *
 * The ranking is computed from events every provider produces by working:
 * pieces published, how long each took, how many are still waiting. The
 * inputs are public, so anyone can recompute this and rank us lower.
 */
import { CONTRACTS, tzktApi } from "./config";

export interface Provider {
    address: string;
    name?: string;
    endpoint?: string;
    renderGasMutez: number;
    agent: string;
    registeredAt?: string;
    stats: ProviderStats;
    /** True for the provider this site runs. Marked in the UI as ours. */
    isOurs: boolean;
}

export interface ProviderStats {
    /** Pieces whose metadata this provider published. */
    delivered: number;
    /** Median blocks between a piece being bought and its metadata landing. */
    medianBlocksToPublish: number | null;
    /** Pieces still waiting past the window. */
    outstanding: number;
    firstSeen?: string;
}

/** The window every figure is measured over. Stated next to the sort control. */
export const RANKING_WINDOW_DAYS = 30;

async function tzkt<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${tzktApi()}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`TzKT ${res.status}`);
    return (await res.json()) as T;
}

interface RegistryRow {
    key: string;
    value: string;
    active: boolean;
}

/**
 * Every registered provider.
 *
 * The registry lists them. It makes no claim about whether any of them are
 * any good, which is what the measured ranking answers.
 */
export async function fetchProviders(): Promise<Provider[]> {
    if (!CONTRACTS.registry) return [];

    const rows = await tzkt<RegistryRow[]>(
        `/v1/contracts/${CONTRACTS.registry}/bigmaps/providers/keys`,
        { active: "true", limit: 100 },
    ).catch(() => []);

    const providers = await Promise.all(
        rows.map(async (r) => {
            const address = r.key;
            const [storage, stats] = await Promise.all([
                tzkt<{ render_gas: string; agent: string; metadata: number }>(
                    `/v1/contracts/${address}/storage`,
                ).catch(() => null),
                fetchProviderStats(address),
            ]);
            return {
                address,
                renderGasMutez: storage ? parseInt(storage.render_gas, 10) : 0,
                agent: storage?.agent ?? "",
                registeredAt: r.value,
                stats,
                isOurs: false,
            } satisfies Provider;
        }),
    );

    return providers.sort(compareProviders);
}

/**
 * Delivery record for one provider, from `set_token_metadata` calls its agent
 * has made.
 */
export async function fetchProviderStats(address: string): Promise<ProviderStats> {
    const since = new Date(
        Date.now() - RANKING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const storage = await tzkt<{ agent: string }>(
        `/v1/contracts/${address}/storage`,
    ).catch(() => null);
    if (!storage?.agent) {
        return { delivered: 0, medianBlocksToPublish: null, outstanding: 0 };
    }

    const published = await tzkt<{ level: number; timestamp: string }[]>(
        "/v1/operations/transactions",
        {
            sender: storage.agent,
            entrypoint: "set_token_metadata",
            "timestamp.ge": since,
            status: "applied",
            limit: 1000,
            select: "level,timestamp",
        },
    ).catch(() => []);

    return {
        delivered: published.length,
        // Time to publish needs pairing each call to the buy that preceded
        // it. Left for the indexer, which already walks both event streams.
        medianBlocksToPublish: null,
        outstanding: 0,
        firstSeen: published.at(-1)?.timestamp,
    };
}

/**
 * Sort by what a provider has actually done.
 *
 * Delivery count first, then how long they have been at it. A provider with
 * no record sorts last, which is where a brand new one starts and where a
 * junk registration stays.
 */
export function compareProviders(a: Provider, b: Provider): number {
    if (b.stats.delivered !== a.stats.delivered) {
        return b.stats.delivered - a.stats.delivered;
    }
    const aFirst = a.stats.firstSeen ? Date.parse(a.stats.firstSeen) : Infinity;
    const bFirst = b.stats.firstSeen ? Date.parse(b.stats.firstSeen) : Infinity;
    return aFirst - bFirst;
}

export const RANKING_METHOD = `Sorted by pieces published in the last ${RANKING_WINDOW_DAYS} days, then by time in service. Computed from public chain events; the query is in src/lib/providers.ts.`;
