/**
 * Render providers, and how they are ranked.
 *
 * A provider is any contract exposing `get_render_gas`, `get_agent` and
 * `get_operator`. Anyone can deploy one and list it in the registry, for free.
 *
 * The ranking is computed from events every provider produces by working:
 * pieces published, how long each took, how many are still waiting. The
 * inputs are public, so anyone can recompute this and rank us lower.
 */
import { tzktApi } from "./config";
import { isBlockedProvider } from "./blocklist";
import { addresses } from "./router";
import { bytesToString } from "@/utils/ipfs";

export interface Provider {
    address: string;
    name?: string;
    description?: string;
    /** `ipfs://` avatar or logo, from the provider's own metadata. */
    avatarUri?: string;
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
 * Every registered provider, minus anything this site declines to show.
 *
 * The registry lists them and makes no claim about whether any of them are
 * any good, which is what the measured ranking answers. Hiding one here is a
 * display decision and changes nothing on chain: the provider keeps working
 * for every collection that names it.
 */
export async function fetchProviders(): Promise<Provider[]> {
    const registry = (await addresses()).registry;
    if (!registry) return [];

    const rows = await tzkt<RegistryRow[]>(
        `/v1/contracts/${registry}/bigmaps/providers/keys`,
        { active: "true", limit: 100 },
    ).catch(() => []);

    const providers = await Promise.all(
        rows.map(async (r) => {
            const address = r.key;
            const [storage, stats, meta] = await Promise.all([
                tzkt<{ render_gas: string; agent: string; metadata: number }>(
                    `/v1/contracts/${address}/storage`,
                ).catch(() => null),
                fetchProviderStats(address),
                fetchProviderMetadata(address),
            ]);
            return {
                address,
                name: meta?.name,
                description: meta?.description,
                avatarUri: meta?.avatarUri,
                endpoint: meta?.endpoint,
                renderGasMutez: storage ? parseInt(storage.render_gas, 10) : 0,
                agent: storage?.agent ?? "",
                registeredAt: r.value,
                stats,
                isOurs: false,
            } satisfies Provider;
        }),
    );

    return providers.filter((p) => !isBlockedProvider(p.address)).sort(compareProviders);
}

/**
 * One provider, by address, whether or not it is in the registry.
 *
 * A collection names the provider it pays, and that address is authoritative
 * for the piece. The registry is a directory somebody has to add themselves
 * to, so a collection can perfectly well name a provider missing from it.
 */
export async function fetchProvider(
    address: string,
): Promise<{ address: string; endpoint?: string } | null> {
    const meta = await fetchProviderMetadata(address);
    return meta ? { address, endpoint: meta.endpoint } : null;
}

interface ProviderMeta {
    name?: string;
    description?: string;
    avatarUri?: string;
    endpoint?: string;
}

/**
 * A provider's own description of itself, from its TZIP-016 metadata.
 *
 * Written by the provider, about the provider, so it is presentation and
 * nothing more: none of it affects who may write, what a render costs, or
 * whether a piece is published. A provider that says nothing shows as its
 * address, which is what every provider did until now.
 */
async function fetchProviderMetadata(address: string): Promise<ProviderMeta | null> {
    const row = await tzkt<{ value?: string }>(
        `/v1/contracts/${address}/bigmaps/metadata/keys/content`,
    ).catch(() => null);
    if (!row?.value) return null;
    try {
        const doc = JSON.parse(bytesToString(row.value)) as Record<string, unknown>;
        const str = (k: string) => (typeof doc[k] === "string" ? (doc[k] as string) : undefined);
        return {
            name: str("name"),
            description: str("description"),
            // `avatar` is the key we write. `logo` and `imageUri` are read too,
            // because a provider we did not deploy will have picked its own.
            avatarUri: str("avatar") ?? str("logo") ?? str("imageUri"),
            endpoint: str("endpoint"),
        };
    } catch {
        return null;
    }
}

/** A publish, with the token it was for. */
interface Publish {
    level: number;
    timestamp: string;
    collection: string;
    tokenId: string;
}

/**
 * How many publishes to pair with their buys.
 *
 * Each pairing is a request, so the median is taken over a sample rather than
 * over everything. Fifty is enough for the number to mean something and few
 * enough that the page does not spend a minute assembling itself.
 */
const PAIRING_SAMPLE = 50;

/** Collections to scan for unrendered pieces. */
const OUTSTANDING_SCAN = 20;

/** A piece older than this and still unrendered counts against a provider. */
const OUTSTANDING_AFTER_MINUTES = 30;

/**
 * Everything this provider has published in the window.
 *
 * Read from its agent's calls to `set_token_metadata`, which is the only
 * action a provider takes on chain, so a provider that has done nothing has
 * nothing here and one that has worked cannot hide it.
 */
async function publishes(agent: string, since: string): Promise<Publish[]> {
    const rows = await tzkt<
        {
            level: number;
            timestamp: string;
            target: { address: string };
            parameter: { value: { token_id: string } };
        }[]
    >("/v1/operations/transactions", {
        sender: agent,
        entrypoint: "set_token_metadata",
        "timestamp.ge": since,
        status: "applied",
        limit: 1000,
        select: "level,timestamp,target,parameter",
    }).catch(() => []);

    return rows
        .filter((r) => r.target?.address && r.parameter?.value?.token_id)
        .map((r) => ({
            level: r.level,
            timestamp: r.timestamp,
            collection: r.target.address,
            tokenId: String(r.parameter.value.token_id),
        }));
}

/** The block a piece was minted at, which is when its clock started. */
async function mintLevel(collection: string, tokenId: string): Promise<number | null> {
    const rows = await tzkt<{ level: number }[]>("/v1/contracts/events", {
        contract: collection,
        tag: "mint",
        "payload.token_id": tokenId,
        limit: 1,
        select: "level",
    }).catch(() => []);
    const row = rows[0];
    return typeof row === "number" ? row : (row?.level ?? null);
}

function median(xs: number[]): number | null {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
}

/** Collections whose storage names this provider. */
async function collectionsNaming(provider: string): Promise<string[]> {
    const events = await tzkt<{ contract: { address: string } }[]>(
        "/v1/contracts/events",
        { tag: "set_provider", "sort.desc": "id", limit: 500 },
    ).catch(() => []);

    const candidates = [...new Set(events.map((e) => e.contract?.address).filter(Boolean))];
    const naming: string[] = [];

    for (const address of candidates.slice(0, OUTSTANDING_SCAN)) {
        const storage = await tzkt<{ render?: { provider?: string } }>(
            `/v1/contracts/${address}/storage`,
        ).catch(() => null);
        // Storage is what actually points work at a provider. An event
        // payload is written by the contract that emits it.
        if (storage?.render?.provider === provider) naming.push(address);
    }
    return naming;
}

/**
 * Pieces this provider was asked for and has not delivered.
 *
 * A piece still carrying its collection's pending document, bought long
 * enough ago that a working provider would have got to it.
 */
async function outstandingFor(provider: string): Promise<number> {
    const collections = await collectionsNaming(provider);
    const cutoff = Date.now() - OUTSTANDING_AFTER_MINUTES * 60 * 1000;
    let waiting = 0;

    for (const collection of collections) {
        const storage = await tzkt<{ art?: { pending_metadata?: string } }>(
            `/v1/contracts/${collection}/storage`,
        ).catch(() => null);
        const pending = storage?.art?.pending_metadata;
        if (!pending) continue;

        const rows = await tzkt<
            { value: { token_info: Record<string, string> }; firstTime: string }[]
        >(`/v1/contracts/${collection}/bigmaps/token_metadata/keys`, {
            active: "true",
            limit: 200,
        }).catch(() => []);

        for (const row of rows) {
            if (row.value?.token_info?.[""] !== pending) continue;
            if (Date.parse(row.firstTime) < cutoff) waiting++;
        }
    }
    return waiting;
}

/**
 * What a provider has actually done, from chain events alone.
 *
 * Every figure here is derived from actions a provider takes by working, so
 * none of it can be asserted by a provider about itself, and anyone can
 * recompute all of it.
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

    const done = await publishes(storage.agent, since);

    // Pair each publish with the buy that asked for it. The gap in blocks is
    // how long a collector waited.
    const sample = done.slice(0, PAIRING_SAMPLE);
    const gaps: number[] = [];
    for (const p of sample) {
        const minted = await mintLevel(p.collection, p.tokenId);
        if (minted !== null && p.level >= minted) gaps.push(p.level - minted);
    }

    return {
        delivered: done.length,
        medianBlocksToPublish: median(gaps),
        outstanding: await outstandingFor(address).catch(() => 0),
        firstSeen: done.at(-1)?.timestamp,
    };
}

/**
 * Sort by what a provider has actually done.
 *
 * Delivered first, because a provider that has published nothing has told you
 * nothing. Then the share of work still waiting, then how fast the delivered
 * work landed, then time in service as the tiebreak.
 *
 * A brand new provider sorts near the bottom, and so does a junk
 * registration. That is the same treatment, and a new provider climbs out of
 * it by working.
 */
export function compareProviders(a: Provider, b: Provider): number {
    if (b.stats.delivered !== a.stats.delivered) {
        return b.stats.delivered - a.stats.delivered;
    }

    const backlog = (p: Provider) =>
        p.stats.delivered + p.stats.outstanding === 0
            ? 0
            : p.stats.outstanding / (p.stats.delivered + p.stats.outstanding);
    if (backlog(a) !== backlog(b)) return backlog(a) - backlog(b);

    const speed = (p: Provider) => p.stats.medianBlocksToPublish ?? Number.MAX_SAFE_INTEGER;
    if (speed(a) !== speed(b)) return speed(a) - speed(b);

    const first = (p: Provider) => (p.stats.firstSeen ? Date.parse(p.stats.firstSeen) : Infinity);
    return first(a) - first(b);
}
