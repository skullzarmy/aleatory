/**
 * A generator, read from its own storage.
 */
import { fetchStorage, fetchRecentTokens, type TzktToken } from "./tzkt";
import {
    fetchGenerators,
    fetchGeneratorMeta,
    fetchEditionSizes,
    fetchPausedStates,
    fetchSealedStates,
    fetchCreators,
    fetchGeneratorMetas,
    fetchPrices,
    type GeneratorMeta,
    indexerFetch,
    isAddress,
} from "./tzkt";

export { fetchGeneratorMeta, type GeneratorMeta };
import { tzktApi } from "./config";
import { readAddresses } from "./router";
import { isBlockedGenerator } from "./blocklist";
import { bytesToString, ipfsImageUrl } from "@/utils/ipfs";
import { coversFor, piecesOf, type FeedPiece } from "./feed";
import type { ParamsSchema } from "./params";
import { decodeCode } from "./piece";
import { fetchProvider } from "./providers";
import { cacheWrap } from "./cache";
import { normalizeCollab, type Collab } from "./collab";
import { type GeneratorSortKey } from "./generator-sort";

export { normalizeCollab, unconfirmedCount, type Collab, type CollabShare } from "./collab";

interface RawStorage {
    administrator: string;
    /** Absent on a generator from a factory that predates the field. */
    template_version?: string;
    art: {
        code: string;
        code_encoding: string;
        code_uri: string;
        code_sealed: boolean;
        code_hash: string;
        royalties: Record<string, string>;
        pending_metadata: string;
    };
    /** Absent on a generator deployed before collaborations existed. */
    collab?: { shares: Record<string, string>; confirmed: string[] };
    sale: { price: string; edition_size: string; paused: boolean };
    render: {
        provider: string;
        render_gas: string;
        provider_agent: string;
        resolver: string;
        trust_resolver: boolean;
    };
    next_token_id: string;
    metadata: number;
}

export interface Generator {
    address: string;
    /** The administrator, who holds every authority over the generator. */
    artist: string;
    /** Who made it and who the mint price is divided between. */
    collab: Collab;
    /** Which build of the template this came from. 1 for the oldest. */
    templateVersion: number;
    name?: string;
    description?: string;
    /** Standard TZIP-21 tags, read by objkt and other marketplaces. */
    tags?: string[];
    /** The source, decoded from storage. Empty when it is a pointer. */
    code: string;
    /** False while the source is still arriving in chunks. Nothing mints. */
    sealed: boolean;
    codeUri: string;
    codeHash: string;
    priceMutez: bigint;
    renderGasMutez: bigint;
    /** Price plus render gas: what a collector signs for. */
    totalMutez: bigint;
    editionSize: number;
    minted: number;
    paused: boolean;
    soldOut: boolean;
    provider: string;
    /** The provider's own declared name, when it has one. */
    providerName?: string;
    /**
     * Whether the provider still answers. A mint asks them what they charge and
     * fails if they cannot say, so a provider that has gone takes the
     * generator's sales with it until the artist picks another.
     */
    providerReachable: boolean;
    /** Where writer authorisation is resolved from. Fixed at origination. */
    resolver: string;
    /** Whether the resolver's writers may publish metadata here. Artist's call. */
    trustResolver: boolean;
    royalties: { address: string; bps: number }[];
    royaltyTotalBps: number;
    /** Declared parameters, when the source declares any. */
    paramsSchema: ParamsSchema | null;
    /** The cover the artist chose at deploy. */
    coverUrl?: string;
}

/** A provider's price, now. The same number `get_render_gas` returns. */
async function fetchProviderGas(provider: string): Promise<bigint | null> {
    if (!provider) return null;
    try {
        const raw = await fetchStorage<{ render_gas?: string }>(provider);
        return raw?.render_gas === undefined ? null : BigInt(raw.render_gas);
    } catch {
        return null;
    }
}

interface CachedGenerator extends Omit<Generator, "priceMutez" | "renderGasMutez" | "totalMutez"> {
    priceMutez: string;
    renderGasMutez: string;
    totalMutez: string;
}

/** Null when there is no such generator. Throws when the indexer could not be read. */
export async function fetchGenerator(address: string): Promise<Generator | null> {
    if (!isAddress(address)) return null;
    const cached = await cacheWrap<CachedGenerator | null>(
        `generator:${address}`,
        async () => {
            const gen = await fetchGeneratorLive(address);
            if (!gen) return null;
            return {
                ...gen,
                priceMutez: gen.priceMutez.toString(),
                renderGasMutez: gen.renderGasMutez.toString(),
                totalMutez: gen.totalMutez.toString(),
            };
        },
        { freshMs: 30_000, l1Ms: 15_000, staleOk: (gen) => gen !== null },
    );
    if (!cached) return null;
    return {
        ...cached,
        priceMutez: BigInt(cached.priceMutez),
        renderGasMutez: BigInt(cached.renderGasMutez),
        totalMutez: BigInt(cached.totalMutez),
    };
}

async function fetchGeneratorLive(address: string): Promise<Generator | null> {
    const s = await fetchStorage<RawStorage>(address);
    if (!s || !s.art) return null;

    const editionSize = parseInt(s.sale.edition_size, 10);
    const minted = parseInt(s.next_token_id, 10);
    const price = BigInt(s.sale.price);

    // The provider's price now, which is what the contract asks them for. The
    // recorded price is what they charged when they were chosen, and stands in
    // when they cannot be reached.
    const [quoted, providerMeta] = await Promise.all([
        fetchProviderGas(s.render.provider),
        fetchProvider(s.render.provider).catch(() => null),
    ]);
    const gas = quoted ?? BigInt(s.render.render_gas);
    const royalties = Object.entries(s.art.royalties).map(([a, bps]) => ({
        address: a,
        bps: parseInt(String(bps), 10),
    }));

    const meta: GeneratorMeta = await fetchGeneratorMeta(address).catch(() => ({}));
    const { templateVersion, collab } = normalizeCollab(s);

    return {
        address,
        name: meta.name,
        description: meta.description,
        tags: meta.tags,
        paramsSchema: await fetchParamsSchema(address),
        artist: s.administrator,
        collab,
        templateVersion,
        code: await decodeCode(s.art.code, s.art.code_encoding).catch(() => ""),
        sealed: s.art.code_sealed ?? true,
        // sp.string on chain, not sp.bytes, so it needs no decoding. Set only
        // for source too large to carry on chain.
        codeUri: s.art.code_uri,
        codeHash: s.art.code_hash,
        priceMutez: price,
        renderGasMutez: gas,
        totalMutez: price + gas,
        editionSize,
        minted,
        paused: s.sale.paused,
        soldOut: editionSize > 0 && minted >= editionSize,
        provider: s.render.provider,
        providerName: providerMeta?.name,
        providerReachable: quoted !== null,
        resolver: s.render.resolver,
        trustResolver: Boolean(s.render.trust_resolver),
        royalties,
        royaltyTotalBps: royalties.reduce((n, r) => n + r.bps, 0),
        coverUrl: (() => {
            const own = meta.displayUri ?? meta.thumbnailUri;
            return own ? ipfsImageUrl(own) : undefined;
        })(),
    };
}

/**
 * A generator's total royalty, and nothing else. `fetchGenerator` carries it
 * too, but pulls the whole storage record, and `art.code` is the source: some
 * fifty kilobytes for a number that fits in a word. TzKT's `path` selector
 * returns the one field.
 *
 * Not clamped. `proceeds` applies the contract's 25% cap, so one place decides
 * what the figure means.
 */
export async function fetchRoyaltyBps(address: string): Promise<number> {
    if (!isAddress(address)) return 0;
    const shares = await indexerFetch(
        `${tzktApi()}/v1/contracts/${address}/storage?path=art.royalties`,
        { next: { revalidate: 300 } } as RequestInit,
    )
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : null))
        .catch(() => null);

    if (!shares) return 0;
    return Object.values(shares).reduce((n, bps) => n + (parseInt(String(bps), 10) || 0), 0);
}

/**
 * The parameter declaration, from the generator's own metadata, under its own
 * key so a mint UI reads one value and not the whole storage record. See
 * docs/params.md §4.
 */
async function fetchParamsSchema(address: string): Promise<ParamsSchema | null> {
    if (!isAddress(address)) return null;
    const rows = await indexerFetch(
        `${tzktApi()}/v1/contracts/${address}/bigmaps/metadata/keys/aleatory%3Aparams`,
        { next: { revalidate: 300 } } as RequestInit,
    )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    const raw = (rows as { value?: string } | null)?.value;
    if (!raw) return null;
    try {
        const parsed = JSON.parse(bytesToString(raw)) as ParamsSchema;
        return Array.isArray(parsed?.params) ? parsed : null;
    } catch {
        return null;
    }
}

export async function fetchGeneratorPieces(address: string, limit?: number): Promise<FeedPiece[]> {
    const key =
        limit !== undefined
            ? `generator:pieces:${address}:${limit}`
            : `generator:pieces:${address}`;
    return cacheWrap(
        key,
        async () => {
            let tokens: TzktToken[];
            if (limit !== undefined) {
                tokens = await fetchRecentTokens([address], limit);
            } else {
                const PAGE = 1000;
                tokens = [];
                for (let offset = 0; ; offset += PAGE) {
                    const batch = await fetchRecentTokens([address], PAGE, offset);
                    tokens.push(...batch);
                    if (batch.length < PAGE) break;
                }
            }
            const meta = await fetchGeneratorMeta(address).catch((): GeneratorMeta => ({}));
            return piecesOf(tokens, new Map([[address, meta.name ?? ""]]));
        },
        { freshMs: 30_000, l1Ms: 15_000 },
    );
}

export interface GeneratorSummary {
    address: string;
    /** Who the generator credits. One name for a solo generator. */
    artists?: string[];
    /** The resolved primary artist name for display and sorting. */
    artistResolvedName?: string;
    name?: string;
    description?: string;
    /**
     * The cover the artist chose at deploy, or the newest rendered piece when a
     * generator has none.
     */
    coverUrl?: string;
    minted: number;
    /** The cap. Zero is an open edition. */
    editionSize: number;
    firstActivity?: string;
    paused: boolean;
    /** False while the source is still arriving in chunks. Nothing mints. */
    sealed: boolean;
    /** The mint price in mutez (sans render fee). String for JSON safety. */
    priceMutez?: string;
}

export interface GeneratorPage {
    generators: GeneratorSummary[];
    /** The address to ask after for the next page. Absent at the end. */
    cursor?: string;
    unconfigured: boolean;
}

/**
 * Candidates resolved per chunk beyond the limit, to cover paused and
 * unsealed generators that are dropped.
 */
const OVERFETCH = 10;

const knownCovers = new Map<string, string>();

/**
 * One page of the catalog, and where the next one starts.
 *
 * The expensive part of a generator is per-generator: its name, its artist,
 * whether it is paused, whether it is sealed. Resolving those for the whole
 * catalog cost five small requests per generator on every page load, which an
 * indexer answers with 429 once the catalog is large enough, and a throttled
 * answer reads as a generator with no name.
 *
 * So the cheap list comes first, one request per factory, already ordered.
 * This walks it in chunks resolving only what decides visibility, and
 * resolves the rest for the twenty that survive. The cost of a page is fixed
 * whatever the catalog grows to.
 *
 * Addressed by cursor rather than offset: a generator paused between one
 * request and the next shifts every later row, which with an offset silently
 * skips a card.
 */
export async function fetchGeneratorPage(
    limit = 20,
    after?: string,
    sortKey: GeneratorSortKey = "created-desc",
    hideSoldOut = false,
): Promise<GeneratorPage> {
    const key = `catalog:page:${limit}:${after ?? "start"}:${sortKey}:${hideSoldOut ? "nosold" : "all"}`;
    return cacheWrap(
        key,
        async () => {
            const factories = (await readAddresses()).factories;
            if (factories.length === 0) {
                return { generators: [], unconfigured: true };
            }
            const settled = await Promise.allSettled(factories.map((f) => fetchGenerators(f)));
            if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;
            const seen = new Set<string>();
            const rows = settled
                .map((r) => (r.status === "fulfilled" ? r.value : []))
                .flat()
                .filter((c) => !seen.has(c.address) && (seen.add(c.address), true))
                .filter((c) => !isBlockedGenerator(c.address));

            const needsEditionsMap =
                hideSoldOut || sortKey === "remaining-desc" || sortKey === "remaining-asc";
            const editionsMap = needsEditionsMap
                ? await fetchEditionSizes(factories, []).catch(() => new Map<string, number>())
                : undefined;

            if (sortKey === "created-asc") {
                rows.sort((a, b) =>
                    (a.firstActivityTime ?? "").localeCompare(b.firstActivityTime ?? ""),
                );
            } else if (sortKey === "minted-desc") {
                rows.sort(
                    (a, b) =>
                        (b.tokensCount ?? 0) - (a.tokensCount ?? 0) ||
                        (b.firstActivityTime ?? "").localeCompare(a.firstActivityTime ?? ""),
                );
            } else if (sortKey === "minted-asc") {
                rows.sort(
                    (a, b) =>
                        (a.tokensCount ?? 0) - (b.tokensCount ?? 0) ||
                        (b.firstActivityTime ?? "").localeCompare(a.firstActivityTime ?? ""),
                );
            } else if (sortKey === "artist-asc") {
                rows.sort((a, b) =>
                    (a.alias || a.address).localeCompare(b.alias || b.address, undefined, {
                        sensitivity: "base",
                    }),
                );
            } else if (sortKey === "artist-desc") {
                rows.sort((a, b) =>
                    (b.alias || b.address).localeCompare(a.alias || a.address, undefined, {
                        sensitivity: "base",
                    }),
                );
            } else if (sortKey === "remaining-desc" || sortKey === "remaining-asc") {
                const getRem = (c: { address: string; tokensCount?: number }) => {
                    const size = editionsMap?.get(c.address) ?? 0;
                    if (size === 0) return Number.POSITIVE_INFINITY;
                    return Math.max(0, size - (c.tokensCount ?? 0));
                };
                if (sortKey === "remaining-desc") {
                    rows.sort(
                        (a, b) =>
                            getRem(b) - getRem(a) ||
                            (b.firstActivityTime ?? "").localeCompare(a.firstActivityTime ?? ""),
                    );
                } else {
                    rows.sort((a, b) => {
                        const remA = getRem(a);
                        const remB = getRem(b);
                        if (remA === 0 && remB > 0) return 1;
                        if (remB === 0 && remA > 0) return -1;
                        return (
                            remA - remB ||
                            (b.firstActivityTime ?? "").localeCompare(a.firstActivityTime ?? "")
                        );
                    });
                }
            } else if (sortKey === "price-desc" || sortKey === "price-asc") {
                const prices = await fetchPrices(rows.map((c) => c.address));
                const getP = (c: { address: string }) => {
                    const p = prices.get(c.address);
                    return p ? BigInt(p) : 0n;
                };
                if (sortKey === "price-desc") {
                    rows.sort((a, b) =>
                        getP(b) > getP(a)
                            ? 1
                            : getP(b) < getP(a)
                              ? -1
                              : (b.firstActivityTime ?? "").localeCompare(
                                    a.firstActivityTime ?? "",
                                ),
                    );
                } else {
                    rows.sort((a, b) =>
                        getP(a) > getP(b)
                            ? 1
                            : getP(a) < getP(b)
                              ? -1
                              : (b.firstActivityTime ?? "").localeCompare(
                                    a.firstActivityTime ?? "",
                                ),
                    );
                }
            } else {
                rows.sort((a, b) =>
                    (b.firstActivityTime ?? "").localeCompare(a.firstActivityTime ?? ""),
                );
            }

            // Everything after the cursor. An address that has since left the
            // list reads as the start, which repeats a page rather than
            // skipping one.
            const from = after ? rows.findIndex((c) => c.address === after) + 1 : 0;
            const pending = rows.slice(from || 0);

            const visible: typeof rows = [];
            let consumed = 0;
            const CHUNK_SIZE = limit + OVERFETCH;

            while (visible.length < limit && consumed < pending.length) {
                const chunk = pending.slice(consumed, consumed + CHUNK_SIZE);
                consumed += chunk.length;

                const chunkAddresses = chunk.map((c) => c.address);
                const [paused, sealed, chunkEditions] = await Promise.all([
                    fetchPausedStates(chunkAddresses).catch(() => new Map<string, boolean>()),
                    fetchSealedStates(chunkAddresses).catch(() => new Map<string, boolean>()),
                    hideSoldOut
                        ? fetchEditionSizes(factories, chunkAddresses).catch(
                              () => new Map<string, number>(),
                          )
                        : Promise.resolve(new Map<string, number>()),
                ]);

                for (const c of chunk) {
                    // Unknown reads as live, the same fail-open bias the badges
                    // take: a generator missing from the grid is worse than one
                    // shown that should not have been.
                    if (!(paused.get(c.address) ?? false) && (sealed.get(c.address) ?? true)) {
                        if (hideSoldOut) {
                            const size =
                                chunkEditions.get(c.address) ?? editionsMap?.get(c.address) ?? 0;
                            const isSoldOut = size > 0 && (c.tokensCount ?? 0) >= size;
                            if (isSoldOut) continue;
                        }
                        visible.push(c);
                        if (visible.length === limit) break;
                    }
                }
            }

            const addresses = visible.map((c) => c.address);
            const [metas, covers, editions, artists, prices] = await Promise.all([
                fetchGeneratorMetas(addresses),
                coversFor(addresses).catch(() => new Map<string, string>()),
                fetchEditionSizes(factories, addresses).catch(() => new Map<string, number>()),
                fetchCreators(addresses).catch(() => new Map<string, string[]>()),
                fetchPrices(addresses).catch(() => new Map<string, string>()),
            ]);

            const rawGenerators: GeneratorSummary[] = visible.map((c) => {
                const meta = metas.get(c.address) ?? {};
                const own = meta.displayUri ?? meta.thumbnailUri;
                const cover = own
                    ? ipfsImageUrl(own)
                    : (covers.get(c.address) ?? knownCovers.get(c.address));
                if (cover) knownCovers.set(c.address, cover);
                return {
                    address: c.address,
                    artists: artists.get(c.address),
                    name: meta.name || c.alias,
                    description: meta.description,
                    coverUrl: cover,
                    minted: c.tokensCount ?? 0,
                    editionSize: editions.get(c.address) ?? 0,
                    firstActivity: c.firstActivityTime,
                    paused: false,
                    sealed: true,
                    priceMutez: prices.get(c.address),
                };
            });

            const generators = hideSoldOut
                ? rawGenerators.filter((c) => !(c.editionSize > 0 && c.minted >= c.editionSize))
                : rawGenerators;

            // The last generator actually used, so the next page resumes
            // after it and the ones dropped here are never looked at again.
            const used = visible.length > 0 ? visible[visible.length - 1].address : undefined;
            const usedIndex = used ? pending.findIndex((c) => c.address === used) : -1;
            const exhausted = usedIndex === -1 || usedIndex + 1 >= pending.length;

            return {
                generators,
                cursor: exhausted ? undefined : used,
                unconfigured: false,
            };
        },
        {
            freshMs: 30_000,
            l1Ms: 15_000,
            redisTtlSec: 86_400,
            staleOk: (data) =>
                Array.isArray(data?.generators) &&
                (data.generators.length > 0 || Boolean(data.cursor)),
        },
    );
}

/**
 * `paused` and `sealed` default off: each is one uncached TzKT request per
 * generator, and the market page calls this just to build a name map, never
 * reads either. Only a caller that filters on them (the home page) or
 * renders a badge pays for it.
 */
export async function fetchAllGenerators(opts?: {
    paused?: boolean;
    sealed?: boolean;
}): Promise<GeneratorSummary[]> {
    const key = `catalog:${opts?.paused ?? false}:${opts?.sealed ?? false}`;
    return cacheWrap(
        key,
        async () => {
            const factories = (await readAddresses()).factories;
            if (factories.length === 0) return [];
            // One factory failing costs its generators. All of them failing is an outage
            // and throws, so it does not read as a catalog with nothing in it.
            const settled = await Promise.allSettled(factories.map((f) => fetchGenerators(f)));
            if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;
            const lists = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
            const seen = new Set<string>();
            const rows = lists
                .flat()
                .filter((c) => !seen.has(c.address) && (seen.add(c.address), true))
                .filter((c) => !isBlockedGenerator(c.address))
                // Each factory's list is newest first, so flattening leaves one run per
                // factory rather than one order.
                .sort((a, b) =>
                    (b.firstActivityTime ?? "").localeCompare(a.firstActivityTime ?? ""),
                );
            const addresses = rows.map((c) => c.address);
            const [metas, covers, editions, paused, sealed, artists, prices] = await Promise.all([
                fetchGeneratorMetas(addresses),
                coversFor(addresses).catch(() => new Map<string, string>()),
                fetchEditionSizes(factories, addresses).catch(() => new Map<string, number>()),
                opts?.paused
                    ? fetchPausedStates(addresses).catch(() => new Map<string, boolean>())
                    : Promise.resolve(new Map<string, boolean>()),
                opts?.sealed
                    ? fetchSealedStates(addresses).catch(() => new Map<string, boolean>())
                    : Promise.resolve(new Map<string, boolean>()),
                fetchCreators(addresses).catch(() => new Map<string, string[]>()),
                fetchPrices(addresses).catch(() => new Map<string, string>()),
            ]);

            return rows.map((c) => {
                const meta = metas.get(c.address) ?? {};
                return {
                    address: c.address,
                    artists: artists.get(c.address),
                    // `alias` is TzKT's, set for contracts it happens to know.
                    name: meta.name || c.alias,
                    description: meta.description,
                    // The artist's own cover first, pinned at deploy, so a generator has a
                    // face before its first piece finishes rendering.
                    coverUrl: (() => {
                        const own = meta.displayUri ?? meta.thumbnailUri;
                        const cover = own
                            ? ipfsImageUrl(own)
                            : (covers.get(c.address) ?? knownCovers.get(c.address));
                        if (cover) knownCovers.set(c.address, cover);
                        return cover;
                    })(),
                    minted: c.tokensCount ?? 0,
                    editionSize: editions.get(c.address) ?? 0,
                    firstActivity: c.firstActivityTime,
                    // Unknown reads as not-paused: a missing badge is a cosmetic miss, a
                    // false "paused" on every row this failed for would be worse.
                    paused: paused.get(c.address) ?? false,
                    // Unknown reads as sealed, the same fail-open bias as paused above.
                    sealed: sealed.get(c.address) ?? true,
                    priceMutez: prices.get(c.address),
                };
            });
        },
        {
            freshMs: 30_000,
            l1Ms: 15_000,
            redisTtlSec: 86_400,
            staleOk: (data) =>
                Array.isArray(data) && data.length > 0 && data.some((g) => Boolean(g.coverUrl)),
        },
    );
}

/**
 * All live, unpaused, sealed generators across the platform.
 * Warmed in the shared cache once every 30 seconds.
 */
export async function fetchLiveCatalog(): Promise<{
    generators: GeneratorSummary[];
    unconfigured: boolean;
}> {
    const factories = (await readAddresses()).factories;
    if (factories.length === 0) {
        return { generators: [], unconfigured: true };
    }
    const all = await fetchAllGenerators({ paused: true, sealed: true });
    const live = all.filter((g) => !g.paused && g.sealed);
    return { generators: live, unconfigured: false };
}
