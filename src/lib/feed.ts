/** Pieces minted across every Aleatory generator, newest first. */
import { allFactories } from "./router";
import {
    fetchGenerators,
    fetchGeneratorsDeployedBy,
    fetchRecentTokens,
    fetchTokensIn,
    fetchStorage,
    fetchGeneratorMeta,
    type GeneratorMeta,
    fetchTokensHeldBy,
    fetchTokenUris,
    fetchEditionSizes,
    type TzktToken,
} from "./tzkt";
import { isBlockedGenerator } from "./blocklist";
// Type only, so the cycle with generator.ts (which imports coversFor from
// here) is erased at compile time and never exists at runtime.
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
}

/**
 * Generator names, from each generator's own metadata document. TzKT's
 * `alias` is set only for contracts it happens to know, never for one of ours.
 */
async function namesFor(addresses: string[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
        addresses.map(async (a) => {
            const meta = await fetchGeneratorMeta(a).catch((): GeneratorMeta => ({}));
            return [a, meta.name ?? ""] as const;
        }),
    );
    return new Map(entries.filter(([, name]) => name));
}

/**
 * For each token, its own metadata pointer and its generator's pending one.
 * Two reads per generator, not per token.
 */
async function pendingState(
    tokens: TzktToken[],
): Promise<Map<string, { pendingUri: string; tokenUri?: string }>> {
    const generators = [...new Set(tokens.map((t) => t.contract.address))];
    const entries = await Promise.all(
        generators.map(
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

/** A generator's pending pointer. */
async function pendingUriOf(generator: string): Promise<string> {
    const s = await fetchStorage<{ art?: { pending_metadata?: string } }>(generator).catch(
        () => null,
    );
    const raw = s?.art?.pending_metadata;
    return raw ? bytesToString(raw) : "";
}

async function resolveDocs(generator: string, tokenIds: string[]): Promise<Map<string, TokenDoc>> {
    const out = new Map<string, TokenDoc>();
    if (tokenIds.length === 0) return out;

    const uris = await fetchTokenUris(generator).catch(() => new Map<string, string>());

    // A document that misses its deadline leaves its piece looking unrendered,
    // which the next request recovers. A page that never returns does not.
    //
    // Measured: this gateway answers in 3.6 to 5.8 seconds, so the deadline has
    // to clear the slow end. Concurrency is what keeps the page quick.
    const CONCURRENCY = 8;
    const TIMEOUT_MS = GATEWAY_TIMEOUT_MS;

    const queue = [...tokenIds];
    async function worker() {
        for (;;) {
            const id = queue.shift();
            if (id === undefined) return;
            const uri = uris.get(id);
            if (!uri || !uri.startsWith("ipfs://")) continue;
            const doc = await fetch(convertIpfsToGatewayUrl(uri), {
                next: { revalidate: 300 },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            })
                .then((r) => (r.ok ? (r.json() as Promise<TokenDoc>) : null))
                .catch(() => null);
            if (doc) out.set(id, doc);
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
 * Documents for whatever TzKT left unresolved, grouped so it is one big_map
 * read per generator rather than one per token.
 */
async function docsFor(tokens: TzktToken[]): Promise<Map<string, TokenDoc>> {
    const missing = tokens.filter((t) => !t.metadata?.displayUri && !t.metadata?.thumbnailUri);
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
 * The newest piece with an image, per generator, in one request:
 * `contract.in` returns tokens across every generator at once, newest first,
 * and the first hit per generator wins.
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
    const [docs, state] = await Promise.all([docsFor(tokens), pendingState(tokens)]);

    const out = new Map<string, string>();
    for (const t of tokens) {
        const address = t.contract.address;
        if (out.has(address)) continue;
        const m = t.metadata ?? docs.get(key(t));
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
    artist?: string;
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
    // never, so the document fetched here fills in for it.
    const m = t.metadata ?? resolved;
    const display = m?.displayUri || m?.thumbnailUri;
    // The pointer comparison, which is the provider's own queue rule, so the
    // site and the daemon cannot disagree. "Has no image" is not the test: a
    // pending document carries the generator cover as its displayUri.
    const pending =
        pendingState?.pendingUri && pendingState.tokenUri
            ? pendingState.tokenUri === pendingState.pendingUri
            : !display;
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
        artist: t.firstMinter?.address,
        mintedAt: t.firstTime,
        imageUrl: display ? ipfsImageUrl(display) : undefined,
        artifactUrl: m?.artifactUri ? ipfsImageUrl(m.artifactUri) : undefined,
        pending,
    };
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

    const [docs, state] = await Promise.all([docsFor(tokens), pendingState(tokens)]);

    return new Map(
        tokens.map((t) => [
            key(t),
            toPiece(t, names?.get(t.contract.address), docs.get(key(t)), state.get(key(t))),
        ]),
    );
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
}

export async function fetchRecentFeed(limit = 48, offset = 0, only?: string): Promise<RecentFeed> {
    const factories = await allFactories();
    if (factories.length === 0) {
        return {
            pieces: [],
            generatorCount: 0,
            unconfigured: true,
            hasMore: false,
            generators: [],
            mintingGeneratorCount: 0,
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
        };
    }

    const window = await fetchRecentTokens(
        scoped.map((c) => c.address),
        limit + 1,
        offset,
    );
    const tokens = window.slice(0, limit);
    const [docs, state] = await Promise.all([docsFor(tokens), pendingState(tokens)]);
    return {
        pieces: tokens.map((t) =>
            toPiece(t, aliasByAddress.get(t.contract.address), docs.get(key(t)), state.get(key(t))),
        ),
        generatorCount: all.length,
        unconfigured: false,
        hasMore: window.length > limit,
        generators: picker,
        mintingGeneratorCount: minting,
    };
}

export interface WalletView {
    /** Pieces this account holds now. */
    held: FeedPiece[];
    /** Generators this account deployed, as the generators wall shows them. */
    made: GeneratorSummary[];
    unconfigured: boolean;
}

/** One account, both ways round: what they hold and what they made. */
export async function fetchWallet(account: string, limit = 48): Promise<WalletView> {
    const factories = await allFactories();
    if (factories.length === 0) {
        return { held: [], made: [], unconfigured: true };
    }
    const generators = (await generatorsFrom(factories)).filter(
        (c) => !isBlockedGenerator(c.address),
    );
    const aliasByAddress = await namesFor(generators.map((c) => c.address));
    const addresses = generators.map((c) => c.address);

    const [tokens, deployed] = await Promise.all([
        fetchTokensHeldBy(account, addresses, limit).catch(() => []),
        Promise.all(
            factories.map((f) => fetchGeneratorsDeployedBy(account, f).catch(() => [])),
        ).then((lists) => lists.flat()),
    ]);

    const madeSet = new Set(deployed);
    const mine = generators.filter((c) => madeSet.has(c.address));
    const madeAddresses = mine.map((c) => c.address);

    // The made side is a handful of generators, so the cover, the edition size
    // and the artist's own name are worth the extra reads.
    const [docs, state, metas, covers, editions] = await Promise.all([
        docsFor(tokens),
        pendingState(tokens),
        Promise.all(
            madeAddresses.map(
                (a): Promise<GeneratorMeta> => fetchGeneratorMeta(a).catch(() => ({})),
            ),
        ),
        coversFor(madeAddresses).catch(() => new Map<string, string>()),
        fetchEditionSizes(factories, madeAddresses).catch(() => new Map<string, number>()),
    ]);

    return {
        held: tokens.map((t) =>
            toPiece(t, aliasByAddress.get(t.contract.address), docs.get(key(t)), state.get(key(t))),
        ),
        made: mine.map((c, i) => {
            const own = metas[i].displayUri ?? metas[i].thumbnailUri;
            return {
                address: c.address,
                name: metas[i].name || aliasByAddress.get(c.address) || c.alias,
                description: metas[i].description,
                coverUrl: own ? ipfsImageUrl(own) : covers.get(c.address),
                minted: c.tokensCount ?? 0,
                editionSize: editions.get(c.address) ?? 0,
                firstActivity: c.firstActivityTime,
            };
        }),
        unconfigured: false,
    };
}
