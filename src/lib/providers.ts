/**
 * Render providers, and how they are ranked. A provider is any contract
 * exposing `get_render_gas`, `get_agent` and `get_operator`, and anyone can
 * deploy one and list it in the registry for free.
 *
 * The ranking is computed from events a provider produces by working: pieces
 * published, how long each took, how many are still waiting. The inputs are
 * public, so anyone can recompute it.
 */
import { tzktApi } from "./config";
import { indexerFetch } from "./tzkt";
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
    const res = await indexerFetch(url.toString(), { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) throw new Error(`TzKT ${res.status}`);
    return (await res.json()) as T;
}

interface RegistryRow {
    key: string;
    value: string;
    active: boolean;
}

/**
 * Every registered provider, minus anything this site declines to show. Hiding
 * one is a display decision and changes nothing on chain.
 */
export async function fetchProviders(): Promise<Provider[]> {
    const registry = (await addresses()).registry;
    if (!registry) return [];

    const rows = await tzkt<RegistryRow[]>(`/v1/contracts/${registry}/bigmaps/providers/keys`, {
        active: "true",
        limit: 100,
    }).catch(() => []);

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

/** A provider contract as its operator sees it: the controls, and the money. */
export interface OwnedProvider {
    address: string;
    name?: string;
    renderGasMutez: number;
    agent: string;
    operator: string;
    /** Mutez sitting in the contract, which only `withdraw` moves. */
    balanceMutez: number;
    registered: boolean;
}

/**
 * What one provider contract holds and who runs it, read straight from
 * storage. Answers for a contract that was never registered, which is the
 * state an operator is in between deploying and listing.
 *
 * Null when the address is not a provider at all, so a pasted address is
 * refused here rather than at the wallet.
 */
export async function fetchOwnedProvider(address: string): Promise<OwnedProvider | null> {
    if (!/^KT1[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return null;

    const [account, storage, meta, registryAddress] = await Promise.all([
        tzkt<{ balance?: number }>(`/v1/accounts/${address}`).catch(() => null),
        tzkt<{ render_gas?: string; agent?: string; operator?: string }>(
            `/v1/contracts/${address}/storage`,
        ).catch(() => null),
        fetchProviderMetadata(address),
        addresses().then((a) => a.registry),
    ]);

    // The three fields the registry's own views are built on. A contract
    // missing any of them would be refused by `register`, so it is refused
    // here too rather than sending the operator to a wallet that will fail.
    if (!storage?.operator || !storage.agent || storage.render_gas === undefined) return null;

    const listed = registryAddress
        ? await tzkt<{ key: string }[]>(`/v1/contracts/${registryAddress}/bigmaps/providers/keys`, {
              active: "true",
              key: address,
              limit: 1,
          })
              .then((rows) => rows.length > 0)
              .catch(() => false)
        : false;

    return {
        address,
        name: meta?.name,
        renderGasMutez: parseInt(storage.render_gas, 10) || 0,
        agent: storage.agent,
        operator: storage.operator,
        balanceMutez: account?.balance ?? 0,
        registered: listed,
    };
}

/**
 * Provider contracts this account operates. Only the registered ones can be
 * found this way, since nothing indexes a contract nobody has listed: an
 * operator reaches an unregistered one by pasting its address.
 */
export async function fetchProvidersOperatedBy(account: string): Promise<OwnedProvider[]> {
    const registry = (await addresses()).registry;
    if (!registry || !account) return [];

    const rows = await tzkt<RegistryRow[]>(`/v1/contracts/${registry}/bigmaps/providers/keys`, {
        active: "true",
        limit: 100,
    }).catch(() => []);

    const owned = await Promise.all(rows.map((r) => fetchOwnedProvider(r.key).catch(() => null)));
    return owned.filter((p): p is OwnedProvider => p !== null && p.operator === account);
}

/**
 * One provider, by address, whether or not it is in the registry. A generator
 * names the provider it pays, and the registry is a directory somebody has to
 * add themselves to.
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
 * Presentation only: none of it affects who may write, what a render costs, or
 * whether a piece is published. A provider that says nothing shows its address.
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
            // `avatar` is the key we write; a provider we did not deploy picked
            // its own.
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
    generator: string;
    tokenId: string;
}

/** How many publishes to pair with their buys. Each pairing costs a request. */
const PAIRING_SAMPLE = 50;

/** Generators to scan for unrendered pieces. */
const OUTSTANDING_SCAN = 20;

/** A piece older than this and still unrendered counts against a provider. */
const OUTSTANDING_AFTER_MINUTES = 30;

/**
 * Everything this provider has published in the window, from its agent's calls
 * to `set_token_metadata`, which is the only action a provider takes on chain.
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
            generator: r.target.address,
            tokenId: String(r.parameter.value.token_id),
        }));
}

/** The block a piece was minted at, which is when its clock started. */
async function mintLevel(generator: string, tokenId: string): Promise<number | null> {
    const rows = await tzkt<{ level: number }[]>("/v1/contracts/events", {
        contract: generator,
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
    return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** Generators whose storage names this provider. */
async function generatorsNaming(provider: string): Promise<string[]> {
    const events = await tzkt<{ contract: { address: string } }[]>("/v1/contracts/events", {
        tag: "set_provider",
        "sort.desc": "id",
        limit: 500,
    }).catch(() => []);

    const candidates = [...new Set(events.map((e) => e.contract?.address).filter(Boolean))];
    const naming: string[] = [];

    for (const address of candidates.slice(0, OUTSTANDING_SCAN)) {
        const storage = await tzkt<{ render?: { provider?: string } }>(
            `/v1/contracts/${address}/storage`,
        ).catch(() => null);
        // Storage points work at a provider. An event payload is written by the
        // contract that emits it.
        if (storage?.render?.provider === provider) naming.push(address);
    }
    return naming;
}

/**
 * Pieces still carrying their generator's pending document, bought long enough
 * ago that a working provider would have got to them.
 */
async function outstandingFor(provider: string): Promise<number> {
    const generators = await generatorsNaming(provider);
    const cutoff = Date.now() - OUTSTANDING_AFTER_MINUTES * 60 * 1000;
    let waiting = 0;

    for (const generator of generators) {
        const storage = await tzkt<{ art?: { pending_metadata?: string } }>(
            `/v1/contracts/${generator}/storage`,
        ).catch(() => null);
        const pending = storage?.art?.pending_metadata;
        if (!pending) continue;

        const rows = await tzkt<
            { value: { token_info: Record<string, string> }; firstTime: string }[]
        >(`/v1/contracts/${generator}/bigmaps/token_metadata/keys`, {
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
 * What a provider has done, from chain events alone, so none of it can be
 * asserted by a provider about itself.
 */
export async function fetchProviderStats(address: string): Promise<ProviderStats> {
    const since = new Date(Date.now() - RANKING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const storage = await tzkt<{ agent: string }>(`/v1/contracts/${address}/storage`).catch(
        () => null,
    );
    if (!storage?.agent) {
        return { delivered: 0, medianBlocksToPublish: null, outstanding: 0 };
    }

    const done = await publishes(storage.agent, since);

    // Pair each publish with the buy that asked for it. The gap in blocks is
    // how long a collector waited.
    const sample = done.slice(0, PAIRING_SAMPLE);
    const gaps: number[] = [];
    for (const p of sample) {
        const minted = await mintLevel(p.generator, p.tokenId);
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
 * Sort by what a provider has done: delivered, then the share of work still
 * waiting, then how fast the delivered work landed, then time in service. A new
 * provider and a junk registration both start at the bottom.
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
