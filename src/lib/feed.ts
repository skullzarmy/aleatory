/** Pieces minted across every Aleatory generator, newest first. */
import { allFactories } from "./router";
import { cacheWrap } from "./cache";
import {
    fetchGenerators,
    fetchGeneratorsDeployedBy,
    fetchContractsByAddress,
    fetchRecentTokens,
    fetchTokensIn,
    fetchStorage,
    fetchGeneratorMeta,
    fetchGeneratorMetas,
    type GeneratorMeta,
    fetchTokensHeldBy,
    fetchHeldCount,
    fetchTokenUris,
    fetchEditionSizes,
    fetchPausedStates,
    fetchSealedStates,
    fetchCreators,
    fetchGeneratorsNaming,
    type TzktToken,
} from "./tzkt";
import { isBlockedGenerator } from "./blocklist";
// Type only, so the cycle with generator.ts (which imports from here) is
// erased at compile time and never exists at runtime.
import type { GeneratorSummary } from "./generator";
import {
    bytesToString,
    convertIpfsToGatewayUrl,
    GATEWAY_TIMEOUT_MS,
    ipfsImageUrl,
} from "@/utils/ipfs";

interface TokenDoc {
    name?: string;
    displayUri?: string;
    thumbnailUri?: string;
    artifactUri?: string;
    aleaProvider?: string;
}

/**
 * Generator names, from each generator's own metadata document. TzKT's
 * `alias` is set only for contracts it happens to know, never for one of ours.
 */
async function namesFor(addresses: string[]): Promise<Map<string, string>> {
    const metas = await fetchGeneratorMetas(addresses);
    const out = new Map<string, string>();
    for (const [address, meta] of metas) {
        if (meta.name) out.set(address, meta.name);
    }
    return out;
}

const pendingUriCache = new Map<string, string>();

/** A generator's pending pointer, cached in memory since origination storage is immutable. */
async function pendingUriOf(generator: string): Promise<string> {
    const cached = pendingUriCache.get(generator);
    if (cached !== undefined) return cached;
    const s = await fetchStorage<{ art?: { pending_metadata?: string } }>(generator).catch(
        () => null,
    );
    const raw = s?.art?.pending_metadata;
    const uri = raw ? bytesToString(raw) : "";
    if (uri) pendingUriCache.set(generator, uri);
    return uri;
}

/**
 * For each token, its own metadata pointer and its generator's pending one.
 * Only checks generators for tokens that either lack displayUri or were minted recently (last 2 hours),
 * avoiding 100+ contract storage round trips for revealed historical collections.
 */
async function pendingState(
    tokens: TzktToken[],
): Promise<Map<string, { pendingUri: string; tokenUri?: string }>> {
    const now = Date.now();
    const generatorsToCheck = new Set<string>();
    for (const t of tokens) {
        const isRevealed = Boolean(t.metadata?.aleaProvider);
        const isRecent = t.firstTime
            ? now - new Date(t.firstTime).getTime() < 2 * 3600 * 1000
            : false;
        if (!isRevealed || isRecent) {
            generatorsToCheck.add(t.contract.address);
        }
    }

    if (generatorsToCheck.size === 0) return new Map();

    const entries = await Promise.all(
        [...generatorsToCheck].map(
            async (c) =>
                [
                    c,
                    {
                        pending: await pendingUriOf(c),
                        uris: await fetchTokenUris(c).catch(() => new Map<string, string>()),
                    },
                ] as const,
        ),
    );
    const byGenerator = new Map(entries);
    const out = new Map<string, { pendingUri: string; tokenUri?: string }>();
    for (const t of tokens) {
        const c = byGenerator.get(t.contract.address);
        if (c) out.set(key(t), { pendingUri: c.pending, tokenUri: c.uris.get(t.tokenId) });
    }
    return out;
}

const docCache = new Map<string, TokenDoc>();

async function resolveDocs(generator: string, tokenIds: string[]): Promise<Map<string, TokenDoc>> {
    const out = new Map<string, TokenDoc>();
    if (tokenIds.length === 0) return out;

    const uris = await fetchTokenUris(generator).catch(() => new Map<string, string>());

    const CONCURRENCY = 8;
    const TIMEOUT_MS = GATEWAY_TIMEOUT_MS;

    const queue = [...tokenIds];
    async function worker() {
        for (;;) {
            const id = queue.shift();
            if (id === undefined) return;
            const uri = uris.get(id);
            if (!uri || !uri.startsWith("ipfs://")) continue;
            const cached = docCache.get(uri);
            if (cached) {
                out.set(id, cached);
                continue;
            }
            const doc = await fetch(convertIpfsToGatewayUrl(uri), {
                next: { revalidate: 300 },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            })
                .then((r) => (r.ok ? (r.json() as Promise<TokenDoc>) : null))
                .catch(() => null);
            if (doc) {
                docCache.set(uri, doc);
                out.set(id, doc);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return out;
}

const key = (t: TzktToken) => `${t.contract.address}:${t.tokenId}`;

/** Every generator from every factory, deduplicated. */
async function generatorsFrom(factories: string[]) {
    const lists = await Promise.all(factories.map((f) => fetchGenerators(f).catch(() => [])));
    const seen = new Set<string>();
    return lists.flat().filter((c) => {
        if (seen.has(c.address)) return false;
        seen.add(c.address);
        return true;
    });
}

/**
 * Documents for whatever TzKT left unresolved or unindexed, grouped so it is one
 * big_map read per generator rather than one per token.
 */
async function docsFor(
    tokens: TzktToken[],
    state?: Map<string, { pendingUri: string; tokenUri?: string }>,
): Promise<Map<string, TokenDoc>> {
    const missing = tokens.filter((t) => {
        const hasDisplay = Boolean(t.metadata?.displayUri || t.metadata?.thumbnailUri);
        const s = state?.get(key(t));
        const isRenderedOnChain = Boolean(
            s?.pendingUri && s?.tokenUri && s.tokenUri !== s.pendingUri,
        );
        return !hasDisplay || (isRenderedOnChain && !t.metadata?.aleaProvider);
    });
    if (missing.length === 0) return new Map();

    const byGenerator = new Map<string, string[]>();
    for (const t of missing) {
        const list = byGenerator.get(t.contract.address) ?? [];
        list.push(t.tokenId);
        byGenerator.set(t.contract.address, list);
    }

    const out = new Map<string, TokenDoc>();
    await Promise.all(
        [...byGenerator].map(async ([generator, ids]) => {
            const docs = await resolveDocs(generator, ids);
            for (const [id, doc] of docs) out.set(`${generator}:${id}`, doc);
        }),
    );
    return out;
}

/**
 * The newest rendered piece's image, per generator, in one request:
 * `contract.in` returns tokens across every generator at once, newest first,
 * and the first rendered token per generator wins.
 *
 * A generator whose pieces are all still rendering has no cover, and the
 * caller shows its source instead.
 */
export async function coversFor(generators: string[]): Promise<Map<string, string>> {
    if (generators.length === 0) return new Map();

    // Enough rows that a busy generator at the front cannot crowd a quiet one
    // off the end before every generator has been seen once.
    const tokens = await fetchRecentTokens(generators, Math.min(generators.length * 8, 400)).catch(
        () => [],
    );
    const state = await pendingState(tokens);
    const docs = await docsFor(tokens, state);

    const out = new Map<string, string>();
    for (const t of tokens) {
        const address = t.contract.address;
        if (out.has(address)) continue;
        // A pending document carries an image too. Rendered means the token no
        // longer points at its generator's pending document and we hold the rendered doc.
        const s = state.get(key(t));
        if (s?.pendingUri && s.tokenUri === s.pendingUri) continue;
        const resolved = docs.get(key(t));
        const m = (resolved?.aleaProvider ? resolved : undefined) ?? t.metadata ?? resolved;
        if (s?.pendingUri && s?.tokenUri && s.tokenUri !== s.pendingUri && !m?.aleaProvider) {
            continue;
        }
        const display = m?.displayUri || m?.thumbnailUri;
        if (display) out.set(address, ipfsImageUrl(display));
    }
    return out;
}

export interface FeedPiece {
    key: string;
    contract: string;
    tokenId: string;
    name: string;
    generatorName: string;
    /** Whoever minted this specific token — a collector as often as not, not the generator's artist. */
    minter?: string;
    mintedAt?: string;
    /** Rendered image, once a provider has published one. */
    imageUrl?: string;
    /** The source itself, framed live when there is no image yet. */
    artifactUrl?: string;
    /** True while the piece still carries its generator's "not revealed yet" document. */
    pending: boolean;
}

function toPiece(
    t: TzktToken,
    generatorAlias?: string,
    resolved?: TokenDoc,
    /** The generator's pending pointer, and this token's, when known. */
    pendingState?: { pendingUri: string; tokenUri?: string },
): FeedPiece {
    // TzKT resolves `ipfs://` metadata on its own schedule and on some networks
    // never, so the document fetched here fills in for it. If the resolved document
    // carries aleaProvider, it is newer than an unindexed pending doc TzKT still holds.
    const m = (resolved?.aleaProvider ? resolved : undefined) ?? t.metadata ?? resolved;
    const isRenderedOnChain = Boolean(
        pendingState?.pendingUri &&
            pendingState?.tokenUri &&
            pendingState.tokenUri !== pendingState.pendingUri,
    );
    const isRendered = Boolean(m?.aleaProvider);

    // The pointer comparison, which is the provider's own queue rule, so the
    // site and the daemon cannot disagree. "Has no image" is not the test: a
    // pending document carries the generator cover as its displayUri. When
    // rendered on chain, remain pending until the rendered document itself has
    // resolved so the placeholder cover is not shown as the finished piece.
    const pending = isRenderedOnChain
        ? !isRendered
        : pendingState?.pendingUri && pendingState.tokenUri
          ? pendingState.tokenUri === pendingState.pendingUri
          : !m?.displayUri && !m?.thumbnailUri;

    const display = m?.displayUri || m?.thumbnailUri;
    const generatorName = generatorAlias || t.contract.alias || "Untitled generator";
    const edition = `#${Number(t.tokenId) + 1}`;

    // The pending document is one CID shared by every unrevealed token, so it
    // cannot name any of them. Derived in the form the real document uses, so
    // the name does not change when the render lands.
    const name = pending ? `${generatorName} ${edition}` : m?.name || edition;

    return {
        key: `${t.contract.address}:${t.tokenId}`,
        contract: t.contract.address,
        tokenId: t.tokenId,
        name,
        generatorName,
        minter: t.firstMinter?.address,
        mintedAt: t.firstTime,
        imageUrl: display ? ipfsImageUrl(display) : undefined,
        artifactUrl: m?.artifactUri ? ipfsImageUrl(m.artifactUri) : undefined,
        pending,
    };
}

/** Tokens as cards, resolved and named the same way on every page. */
export async function piecesOf(
    tokens: TzktToken[],
    /** Generator names, from each generator's own metadata. */
    names?: Map<string, string>,
): Promise<FeedPiece[]> {
    const state = await pendingState(tokens);
    const docs = await docsFor(tokens, state);
    return tokens.map((t) =>
        toPiece(t, names?.get(t.contract.address), docs.get(key(t)), state.get(key(t))),
    );
}

/**
 * Turn a set of (generator, token) pairs into real pieces. A listing carries a
 * generator, a token id and a price, so the image, the name and the artist are
 * a separate read.
 *
 * One query for the whole page. `contract.in` and `tokenId.in` filter
 * independently, so this over-fetches the cross product and keeps the pairs
 * asked for.
 */
export async function piecesFor(
    pairs: { generator: string; tokenId: string }[],
    /** Generator names, when the caller already has them. */
    names?: Map<string, string>,
): Promise<Map<string, FeedPiece>> {
    if (pairs.length === 0) return new Map();

    const wanted = new Set(pairs.map((p) => `${p.generator}:${p.tokenId}`));
    const generators = [...new Set(pairs.map((p) => p.generator))];
    const tokenIds = [...new Set(pairs.map((p) => p.tokenId))];

    const tokens = (await fetchTokensIn(generators, tokenIds).catch(() => [])).filter((t) =>
        wanted.has(key(t)),
    );

    const pieces = await piecesOf(tokens, names);
    return new Map(pieces.map((p) => [p.key, p]));
}

/** How many generators the scope offers before it stops being scannable. */
const PICKER_MAX = 12;

/**
 * Names are the artist's and nothing stops two of them matching: three
 * generators here are called Drift. A repeated name carries its address so the
 * choice is between two distinguishable things.
 */
function pickerFor(
    all: { address: string; alias?: string; tokensCount?: number; lastActivityTime?: string }[],
    names: Map<string, string>,
): { address: string; name: string }[] {
    const active = all
        .filter((c) => (c.tokensCount ?? 0) > 0)
        .sort((a, b) => (b.lastActivityTime ?? "").localeCompare(a.lastActivityTime ?? ""))
        .slice(0, PICKER_MAX);

    const counts = new Map<string, number>();
    for (const c of active) {
        const n = names.get(c.address) || c.alias || "";
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }

    return active.map((c) => {
        const n = names.get(c.address) || c.alias;
        if (!n) return { address: c.address, name: shortish(c.address) };
        return {
            address: c.address,
            name: (counts.get(n) ?? 0) > 1 ? `${n} ${shortish(c.address)}` : n,
        };
    });
}

const shortish = (a: string) => `${a.slice(0, 5)}…${a.slice(-4)}`;

export interface RecentFeed {
    pieces: FeedPiece[];
    generatorCount: number;
    /** True when no factory address is set. Distinct from a quiet feed. */
    unconfigured: boolean;
    /** Read by asking for one row past the page, not by counting. */
    hasMore: boolean;
    /** The most recently active generators, capped at PICKER_MAX. */
    generators: { address: string; name: string }[];
    /** How many have anything minted, so a capped picker can say so. */
    mintingGeneratorCount: number;
    /** Each piece's generator's creators, keyed by generator address. */
    artists: Map<string, string[]>;
}

interface CachedRecentFeed {
    pieces: FeedPiece[];
    generatorCount: number;
    unconfigured: boolean;
    hasMore: boolean;
    generators: { address: string; name: string }[];
    mintingGeneratorCount: number;
    artists: [string, string[]][];
}

export interface LiveMintsCatalog {
    pieces: FeedPiece[];
    generators: { address: string; name: string }[];
    artists: [string, string[]][];
}

/**
 * All minted pieces across all generators, cached with SWR.
 * Serves in-memory client store for instantaneous sorting and filtering.
 */
export async function fetchLiveMints(): Promise<LiveMintsCatalog> {
    return cacheWrap<LiveMintsCatalog>(
        "feed:mints:live",
        async () => {
            const factories = await allFactories();
            if (factories.length === 0) {
                return { pieces: [], generators: [], artists: [] };
            }
            const all = (await generatorsFrom(factories)).filter(
                (c) => !isBlockedGenerator(c.address),
            );
            if (all.length === 0) {
                return { pieces: [], generators: [], artists: [] };
            }

            const genAddresses = all.map((c) => c.address);

            // All generators with minted pieces, sorted recent-activity first
            const activeGenerators = all
                .filter((c) => (c.tokensCount ?? 0) > 0)
                .sort((a, b) => (b.lastActivityTime ?? "").localeCompare(a.lastActivityTime ?? ""));

            if (activeGenerators.length === 0) {
                return { pieces: [], generators: [], artists: [] };
            }

            const mintingAddresses = activeGenerators.map((c) => c.address);

            const [aliasByAddress, allTokens] = await Promise.all([
                namesFor(genAddresses),
                (async () => {
                    const PAGE = 1000;
                    const tokens: TzktToken[] = [];
                    for (let offset = 0; ; offset += PAGE) {
                        const batch = await fetchRecentTokens(mintingAddresses, PAGE, offset);
                        tokens.push(...batch);
                        if (batch.length < PAGE) break;
                    }
                    if (tokens.length === 0 && mintingAddresses.length > 0) {
                        throw new Error("Indexer returned no tokens for active generators");
                    }
                    return tokens;
                })(),
            ]);

            const counts = new Map<string, number>();
            for (const c of activeGenerators) {
                const n = aliasByAddress.get(c.address) || c.alias || "";
                if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
            }

            const dropdownGenerators = activeGenerators.map((c) => {
                const n = aliasByAddress.get(c.address) || c.alias;
                if (!n) return { address: c.address, name: shortish(c.address) };
                return {
                    address: c.address,
                    name: (counts.get(n) ?? 0) > 1 ? `${n} ${shortish(c.address)}` : n,
                };
            });

            const artistsMap = new Map<string, string[]>();
            const needingCreators: string[] = [];

            for (const t of allTokens) {
                if (!artistsMap.has(t.contract.address) && t.metadata?.creators?.length) {
                    artistsMap.set(t.contract.address, t.metadata.creators);
                }
            }

            for (const addr of genAddresses) {
                if (!artistsMap.has(addr)) {
                    needingCreators.push(addr);
                }
            }

            const [pieces, fetchedCreators] = await Promise.all([
                piecesOf(allTokens, aliasByAddress),
                needingCreators.length > 0
                    ? fetchCreators(needingCreators).catch(() => new Map<string, string[]>())
                    : Promise.resolve(new Map<string, string[]>()),
            ]);

            for (const [addr, crs] of fetchedCreators) {
                artistsMap.set(addr, crs);
            }

            return {
                pieces,
                generators: dropdownGenerators,
                artists: Array.from(artistsMap.entries()),
            };
        },
        {
            freshMs: 30_000,
            l1Ms: 15_000,
            redisTtlSec: 86_400,
            staleOk: (data) => data.pieces.length > 0,
        },
    );
}

export async function fetchRecentFeed(limit = 48, offset = 0, only?: string): Promise<RecentFeed> {
    const key = `feed:mints:${limit}:${offset}:${only ?? "all"}`;
    const cached = await cacheWrap<CachedRecentFeed>(
        key,
        async () => {
            const feed = await fetchRecentFeedLive(limit, offset, only);
            return {
                ...feed,
                artists: Array.from(feed.artists.entries()),
            };
        },
        { freshMs: 20_000, l1Ms: 10_000 },
    );
    return {
        ...cached,
        artists: new Map(cached.artists),
    };
}

async function fetchRecentFeedLive(limit = 48, offset = 0, only?: string): Promise<RecentFeed> {
    const factories = await allFactories();
    if (factories.length === 0) {
        return {
            pieces: [],
            generatorCount: 0,
            unconfigured: true,
            hasMore: false,
            generators: [],
            mintingGeneratorCount: 0,
            artists: new Map(),
        };
    }
    // Every factory, not only the current one: a redeploy retires a factory and
    // the generators it made stay real.
    const all = (await generatorsFrom(factories)).filter((c) => !isBlockedGenerator(c.address));
    if (all.length === 0) {
        return {
            pieces: [],
            generatorCount: 0,
            unconfigured: false,
            hasMore: false,
            generators: [],
            mintingGeneratorCount: 0,
            artists: new Map(),
        };
    }
    const aliasByAddress = await namesFor(all.map((c) => c.address));
    const picker = pickerFor(all, aliasByAddress);
    const minting = all.filter((c) => (c.tokensCount ?? 0) > 0).length;

    // An unknown address scopes to nothing rather than falling back to
    // everything, which would show a feed that quietly ignored the request.
    const scoped = only ? all.filter((c) => c.address === only) : all;
    if (scoped.length === 0) {
        return {
            pieces: [],
            generatorCount: all.length,
            unconfigured: false,
            hasMore: false,
            generators: picker,
            mintingGeneratorCount: minting,
            artists: new Map(),
        };
    }

    const [window, artists] = await Promise.all([
        fetchRecentTokens(
            scoped.map((c) => c.address),
            limit + 1,
            offset,
        ),
        fetchCreators(scoped.map((c) => c.address)).catch(() => new Map<string, string[]>()),
    ]);
    return {
        pieces: await piecesOf(window.slice(0, limit), aliasByAddress),
        generatorCount: all.length,
        unconfigured: false,
        hasMore: window.length > limit,
        generators: picker,
        mintingGeneratorCount: minting,
        artists,
    };
}

export interface WalletView {
    held: FeedPiece[];
    heldCount: number;
    heldPages: number;
    /** Each held piece's generator's creators, keyed by generator address. */
    heldArtists: Map<string, string[]>;
    made: GeneratorSummary[];
    madeCount: number;
    madePages: number;
    /**
     * Generators somebody named this account on that it has not accepted.
     * Already being paid; what is waiting is the credit.
     */
    invitations: { address: string; name?: string }[];
    unconfigured: boolean;
}

/** Enough to act on. A wallet named on more than this has a different problem. */
const INVITATION_MAX = 12;

const EMPTY_WALLET: WalletView = {
    held: [],
    heldCount: 0,
    heldPages: 0,
    heldArtists: new Map(),
    made: [],
    madeCount: 0,
    madePages: 0,
    invitations: [],
    unconfigured: true,
};

interface CachedWalletView {
    held: FeedPiece[];
    heldCount: number;
    heldPages: number;
    heldArtists: [string, string[]][];
    made: GeneratorSummary[];
    madeCount: number;
    madePages: number;
    invitations: { address: string; name?: string }[];
    unconfigured: boolean;
}

export async function fetchWallet(
    account: string,
    opts: { tab?: "created" | "collected"; page?: number; perPage?: number } = {},
): Promise<WalletView> {
    const { tab = "collected", page = 1, perPage = 48 } = opts;
    const key = `wallet:${account}:${tab}:${page}:${perPage}`;
    const cached = await cacheWrap<CachedWalletView>(
        key,
        async () => {
            const view = await fetchWalletLive(account, opts);
            return {
                ...view,
                heldArtists: Array.from(view.heldArtists.entries()),
            };
        },
        { freshMs: 30_000, l1Ms: 15_000 },
    );
    return {
        ...cached,
        heldArtists: new Map(cached.heldArtists),
    };
}

async function fetchWalletLive(
    account: string,
    opts: { tab?: "created" | "collected"; page?: number; perPage?: number } = {},
): Promise<WalletView> {
    const { tab = "collected", page = 1, perPage = 48 } = opts;
    const factories = await allFactories();
    if (factories.length === 0) return EMPTY_WALLET;

    const generators = (await generatorsFrom(factories)).filter(
        (c) => !isBlockedGenerator(c.address),
    );
    const addresses = generators.map((c) => c.address);

    // What you made is what you originated, plus what somebody else
    // originated and named you on and you accepted. Being named is not the
    // same as being credited, so the ones still waiting on you are separated
    // out below rather than counted here.
    const [heldCount, originated, namedOn] = await Promise.all([
        fetchHeldCount(account, addresses).catch(() => 0),
        Promise.all(
            factories.map((f) => fetchGeneratorsDeployedBy(account, f).catch(() => [])),
        ).then((lists) => lists.flat()),
        fetchGeneratorsNaming(account, factories).catch(() => []),
    ]);
    const unseen = namedOn.filter((a) => !originated.includes(a) && !isBlockedGenerator(a));
    const credits = await fetchCreators(unseen).catch(() => new Map<string, string[]>());
    const invited = unseen.filter((a) => !(credits.get(a) ?? []).includes(account));
    const deployed = [
        ...new Set([...originated, ...unseen.filter((a) => !invited.includes(a))]),
    ].filter((a) => !isBlockedGenerator(a));

    const invitations = (
        await Promise.all(
            invited.map(async (address) => ({
                address,
                name: (await fetchGeneratorMeta(address).catch((): GeneratorMeta => ({}))).name,
            })),
        )
    ).slice(0, INVITATION_MAX);

    const [paused, sealed] = await Promise.all([
        fetchPausedStates(deployed).catch(() => new Map<string, boolean>()),
        fetchSealedStates(deployed).catch(() => new Map<string, boolean>()),
    ]);
    const madeAddresses = deployed.filter(
        (a) => !(paused.get(a) ?? false) && (sealed.get(a) ?? true),
    );
    const madeCount = madeAddresses.length;

    const heldPages = Math.max(1, Math.ceil(heldCount / perPage));
    const madePages = Math.max(1, Math.ceil(madeCount / perPage));

    let held: FeedPiece[] = [];
    let heldArtists = new Map<string, string[]>();
    if (tab === "collected") {
        const aliasByAddress = await namesFor(addresses);
        const tokens = await fetchTokensHeldBy(
            account,
            addresses,
            perPage,
            (page - 1) * perPage,
        ).catch(() => []);
        const heldGenerators = [...new Set(tokens.map((t) => t.contract.address))];
        const [pieces, artists] = await Promise.all([
            piecesOf(tokens, aliasByAddress),
            fetchCreators(heldGenerators).catch(() => new Map<string, string[]>()),
        ]);
        held = pieces;
        heldArtists = artists;
    }

    let made: GeneratorSummary[] = [];
    if (tab === "created") {
        const pageAddresses = madeAddresses.slice((page - 1) * perPage, page * perPage);
        const [contracts, metas, covers, editions] = await Promise.all([
            fetchContractsByAddress(pageAddresses),
            fetchGeneratorMetas(pageAddresses),
            coversFor(pageAddresses).catch(() => new Map<string, string>()),
            fetchEditionSizes(factories, pageAddresses).catch(() => new Map<string, number>()),
        ]);
        const byAddress = new Map(contracts.map((c) => [c.address, c]));
        made = pageAddresses.map((address) => {
            const c = byAddress.get(address);
            const meta = metas.get(address) ?? {};
            const own = meta.displayUri ?? meta.thumbnailUri;
            return {
                address,
                name: meta.name || c?.alias,
                description: meta.description,
                coverUrl: own ? ipfsImageUrl(own) : covers.get(address),
                minted: c?.tokensCount ?? 0,
                editionSize: editions.get(address) ?? 0,
                firstActivity: c?.firstActivityTime,
                paused: paused.get(address) ?? false,
                sealed: sealed.get(address) ?? true,
            };
        });
    }

    return {
        held,
        heldCount,
        heldPages,
        heldArtists,
        made,
        madeCount,
        madePages,
        invitations,
        unconfigured: false,
    };
}
