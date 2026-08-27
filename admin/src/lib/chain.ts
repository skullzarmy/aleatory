import { ADDRESSES, AGENT_LOW_WATER_MUTEZ, tzktApi } from "./config";

// Read-only chain state, through TzKT. The privileged half is `ops.ts`.

async function tzkt<T>(path: string): Promise<T> {
    const res = await fetch(`${tzktApi()}${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`TzKT ${res.status} for ${path}`);
    return (await res.json()) as T;
}

/** Mutez held by an address, contract or key alike. */
export async function balanceOf(address: string): Promise<number> {
    if (!address) return 0;
    return Number(await tzkt<number>(`/v1/accounts/${address}/balance`));
}

/**
 * Paged deliberately: TzKT returns 100 rows and stops, which for a sum is not
 * a smaller answer but a wrong one that looks plausible.
 */
async function bigMapKeys<T>(ptr: number): Promise<{ key: string; value: T }[]> {
    const out: { key: string; value: T }[] = [];
    const limit = 1000;
    for (let offset = 0; ; offset += limit) {
        const page = await tzkt<{ key: string; value: T }[]>(
            `/v1/bigmaps/${ptr}/keys?active=true&limit=${limit}&offset=${offset}`,
        );
        out.push(...page);
        if (page.length < limit) return out;
    }
}

// --- marketplace ----------------------------------------------------------

interface MarketplaceStorage {
    administrator: string;
    proposed_admin: string | null;
    treasury: string;
    fee_bps: string;
    paused: boolean;
    fees_accrued: string;
    royalties_owed: number;
    offers: number;
    listings: number;
    next_offer_id: string;
    next_listing_id: string;
}

export interface RoyaltyRow {
    recipient: string;
    mutez: number;
}

export interface MarketplaceState {
    address: string;
    administrator: string;
    proposedAdmin: string | null;
    treasury: string;
    feeBps: number;
    paused: boolean;
    /** The three claims on the balance. */
    feesAccrued: number;
    royaltiesOwed: number;
    escrowed: number;
    royaltyRows: RoyaltyRow[];
    activeOffers: number;
    activeListings: number;
    /** What the contract actually holds. */
    balance: number;
    /**
     * Balance minus everything spoken for.
     *
     * Should be zero. Positive means tez arrived that nothing accounts for;
     * negative means the contract has promised more than it holds, which
     * would mean a claim is going to fail. Either way it is the number worth
     * looking at, and nothing else in the system reports it.
     */
    unaccounted: number;
}

/** Address from the router, not the environment: the two drift. */
export async function fetchMarketplace(address: string): Promise<MarketplaceState | null> {
    if (!address) return null;

    const [storage, balance] = await Promise.all([
        tzkt<MarketplaceStorage>(`/v1/contracts/${address}/storage`),
        balanceOf(address),
    ]);

    const [royalties, offers] = await Promise.all([
        bigMapKeys<string>(storage.royalties_owed),
        bigMapKeys<{ amount: string }>(storage.offers),
    ]);

    const royaltyRows = royalties
        .map((r) => ({ recipient: r.key, mutez: Number(r.value) }))
        .filter((r) => r.mutez > 0)
        .sort((a, b) => b.mutez - a.mutez);

    const royaltiesOwed = royaltyRows.reduce((n, r) => n + r.mutez, 0);
    const escrowed = offers.reduce((n, o) => n + Number(o.value.amount), 0);
    const feesAccrued = Number(storage.fees_accrued);

    return {
        address,
        administrator: storage.administrator,
        proposedAdmin: storage.proposed_admin,
        treasury: storage.treasury,
        feeBps: Number(storage.fee_bps),
        paused: storage.paused,
        feesAccrued,
        royaltiesOwed,
        escrowed,
        royaltyRows,
        activeOffers: offers.length,
        activeListings: (await bigMapKeys<unknown>(storage.listings)).length,
        balance,
        unaccounted: balance - feesAccrued - royaltiesOwed - escrowed,
    };
}

// --- factory --------------------------------------------------------------

interface FactoryStorage {
    administrator: string;
    proposed_admin: string | null;
    treasury: string;
    paused: boolean;
    deploy_price: string;
    fees_accrued: string;
    next_collection_id: string;
}

export interface FactoryState {
    address: string;
    administrator: string;
    proposedAdmin: string | null;
    treasury: string;
    paused: boolean;
    deployPrice: number;
    feesAccrued: number;
    balance: number;
    collections: number;
    unaccounted: number;
}

export async function fetchFactory(address: string): Promise<FactoryState | null> {
    if (!address) return null;
    const [storage, balance] = await Promise.all([
        tzkt<FactoryStorage>(`/v1/contracts/${address}/storage`),
        balanceOf(address),
    ]);
    const feesAccrued = Number(storage.fees_accrued);
    return {
        address,
        administrator: storage.administrator,
        proposedAdmin: storage.proposed_admin,
        treasury: storage.treasury,
        paused: storage.paused,
        deployPrice: Number(storage.deploy_price),
        feesAccrued,
        balance,
        collections: Number(storage.next_collection_id),
        unaccounted: balance - feesAccrued,
    };
}

// --- router ---------------------------------------------------------------

interface RouterStorage {
    administrator: string;
    proposed_admin: string | null;
    factories: string[];
    marketplace: string;
    registry: string;
    resolver: string;
}

export interface RouterState {
    address: string;
    administrator: string;
    proposedAdmin: string | null;
    /**
     * The factory a deploy goes to now: the most recent entry.
     *
     * `add_factory` appends and never removes, because collections already
     * deployed keep pointing at the factory that made them and that history
     * has to stay resolvable. The list is therefore an append-only log, and
     * only its last entry is live.
     */
    currentFactory: string;
    factories: string[];
    marketplace: string;
    registry: string;
    resolver: string;
}

export async function fetchRouter(): Promise<RouterState | null> {
    const address = ADDRESSES.router;
    if (!address) return null;
    const s = await tzkt<RouterStorage>(`/v1/contracts/${address}/storage`);
    return {
        address,
        administrator: s.administrator,
        proposedAdmin: s.proposed_admin,
        currentFactory: s.factories[s.factories.length - 1] ?? "",
        factories: s.factories,
        marketplace: s.marketplace,
        registry: s.registry,
        resolver: s.resolver,
    };
}

// --- resolver -------------------------------------------------------------

interface ResolverStorage {
    administrator: string;
    proposed_admin: string | null;
    writers: string[];
}

export interface ResolverState {
    address: string;
    administrator: string;
    proposedAdmin: string | null;
    /** Keys allowed to write resolution entries. The daemon is normally one. */
    writers: string[];
}

export async function fetchResolver(address: string): Promise<ResolverState | null> {
    if (!address) return null;
    const s = await tzkt<ResolverStorage>(`/v1/contracts/${address}/storage`);
    return {
        address,
        administrator: s.administrator,
        proposedAdmin: s.proposed_admin,
        writers: s.writers,
    };
}

// --- registry -------------------------------------------------------------

interface RegistryStorage {
    providers: number;
    count: string;
}

/** The registry has no notion of whose is whose, so this is the list, not yours. */
export async function fetchProviderAddresses(registry: string): Promise<string[]> {
    if (!registry) return [];
    const s = await tzkt<RegistryStorage>(`/v1/contracts/${registry}/storage`);
    const keys = await bigMapKeys<unknown>(s.providers);
    return keys.map((k) => k.key);
}

// --- render provider ------------------------------------------------------

interface ProviderStorage {
    operator: string;
    agent: string;
    render_gas: string;
}

export interface ProviderState {
    address: string;
    operator: string;
    agent: string;
    renderGas: number;
    /** Render gas collected and not yet withdrawn. */
    balance: number;
}

export async function fetchProvider(address: string): Promise<ProviderState | null> {
    if (!address) return null;
    const [s, balance] = await Promise.all([
        tzkt<ProviderStorage>(`/v1/contracts/${address}/storage`),
        balanceOf(address),
    ]);
    return {
        address,
        operator: s.operator,
        agent: s.agent,
        renderGas: Number(s.render_gas),
        balance,
    };
}

// --- the daemon's key -----------------------------------------------------

export interface AgentState {
    address: string;
    balance: number;
    /** Below the mark where publishing is at risk of stopping. */
    low: boolean;
}

/** The daemon's key. Not a contract, and watched for balance only. */
export async function fetchAgent(address: string): Promise<AgentState | null> {
    if (!address) return null;
    const balance = await balanceOf(address);
    return { address, balance, low: balance < AGENT_LOW_WATER_MUTEZ };
}
