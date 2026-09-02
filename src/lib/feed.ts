/**
 * The recent feed: pieces minted across every Aleatory collection, newest
 * first. Assembled from public chain data, so anyone can reproduce it against
 * TzKT.
 */
import { allFactories } from "./router";
import {
    fetchCollections,
    fetchCollectionsDeployedBy,
    fetchRecentTokens,
    fetchTokensIn,
    fetchStorage,
    fetchCollectionMeta,
    type CollectionMeta,
    fetchTokensHeldBy,
    fetchTokenUris,
    fetchEditionSizes,
    type TzktToken,
} from "./tzkt";
import { isBlockedCollection } from "./blocklist";
// Type only, so the cycle with collection.ts (which imports coversFor from
// here) is erased at compile time and never exists at runtime.
import type { CollectionSummary } from "./collection";
import { bytesToString, convertIpfsToGatewayUrl, ipfsImageUrl } from "@/utils/ipfs";

interface TokenDoc {
    name?: string;
    displayUri?: string;
    thumbnailUri?: string;
    artifactUri?: string;
}

/**
 * Metadata documents for a collection, fetched from the chain's own pointers.
 *
 * One big_map read for the whole collection, then one fetch per document that
 * TzKT has not already resolved. Failures are silent on purpose: a document
 * that will not load leaves the piece looking unrendered, which is exactly
 * what it looks like today, rather than taking the page down with it.
 */
/**
 * Collection names, from each collection's own metadata document.
 *
 * Not TzKT's `alias`, which it sets for contracts it happens to know and never
 * for one of ours, so every card read "Untitled collection".
 */
async function namesFor(addresses: string[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
        addresses.map(async (a) => {
            const meta = await fetchCollectionMeta(a).catch((): CollectionMeta => ({}));
            return [a, meta.name ?? ""] as const;
        }),
    );
    return new Map(entries.filter(([, name]) => name));
}

/**
 * For each token, its own metadata pointer and its collection's pending one.
 *
 * Two reads per collection, not per token, and only for the collections
 * actually on screen.
 */
async function pendingState(
    tokens: TzktToken[],
): Promise<Map<string, { pendingUri: string; tokenUri?: string }>> {
    const collections = [...new Set(tokens.map((t) => t.contract.address))];
    const entries = await Promise.all(
        collections.map(
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
    const byCollection = new Map(entries);
    const out = new Map<string, { pendingUri: string; tokenUri?: string }>();
    for (const t of tokens) {
        const c = byCollection.get(t.contract.address);
        if (c) out.set(key(t), { pendingUri: c.pending, tokenUri: c.uris.get(t.tokenId) });
    }
    return out;
}

/** A collection's pending pointer. */
async function pendingUriOf(collection: string): Promise<string> {
    const s = await fetchStorage<{ art?: { pending_metadata?: string } }>(collection).catch(
        () => null,
    );
    const raw = s?.art?.pending_metadata;
    return raw ? bytesToString(raw) : "";
}

async function resolveDocs(collection: string, tokenIds: string[]): Promise<Map<string, TokenDoc>> {
    const out = new Map<string, TokenDoc>();
    if (tokenIds.length === 0) return out;

    const uris = await fetchTokenUris(collection).catch(() => new Map<string, string>());

    // Bounded, and every fetch has a deadline.
    //
    // A gateway takes a few seconds per document and a feed can be dozens of
    // tokens, so unbounded parallel fetches with no timeout is a page that
    // hangs rather than a page that loads. A document that does not arrive in
    // time leaves its piece looking unrendered, which is recoverable on the
    // next request; a page that never returns is not.
    // Measured: this gateway answers in 3.6 to 5.8 seconds. A four second
    // deadline dropped documents at random, so a finished piece showed as
    // unrendered on one load and drew fine on the next. The deadline has to
    // clear the slow end, not the fast one; concurrency keeps the page quick
    // regardless.
    const CONCURRENCY = 8;
    const TIMEOUT_MS = 12_000;

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

/** Every collection from every factory, deduplicated. */
async function collectionsFrom(factories: string[]) {
    const lists = await Promise.all(factories.map((f) => fetchCollections(f).catch(() => [])));
    const seen = new Set<string>();
    return lists.flat().filter((c) => {
        if (seen.has(c.address)) return false;
        seen.add(c.address);
        return true;
    });
}

/**
 * Documents for whatever TzKT left unresolved, grouped so it is one big_map
 * read per collection rather than one per token.
 */
async function docsFor(tokens: TzktToken[]): Promise<Map<string, TokenDoc>> {
    const missing = tokens.filter((t) => !t.metadata?.displayUri && !t.metadata?.thumbnailUri);
    if (missing.length === 0) return new Map();

    const byCollection = new Map<string, string[]>();
    for (const t of missing) {
        const list = byCollection.get(t.contract.address) ?? [];
        list.push(t.tokenId);
        byCollection.set(t.contract.address, list);
    }

    const out = new Map<string, TokenDoc>();
    await Promise.all(
        [...byCollection].map(async ([collection, ids]) => {
            const docs = await resolveDocs(collection, ids);
            for (const [id, doc] of docs) out.set(`${collection}:${id}`, doc);
        }),
    );
    return out;
}

/**
 * One rendered image per collection, for a list that would otherwise be rows of
 * KT1 addresses.
 *
 * The newest piece that has an image, which is the truthful answer to "what
 * does this collection look like now" and costs one request for the whole page:
 * `contract.in` returns tokens across every collection at once, newest first,
 * and the first hit per collection wins.
 *
 * A collection whose pieces are all still rendering has no cover, and the
 * caller shows the generator instead.
 */
export async function coversFor(collections: string[]): Promise<Map<string, string>> {
    if (collections.length === 0) return new Map();

    // Enough rows that a busy collection at the front cannot crowd a quiet one
    // off the end before every collection has been seen once.
    const tokens = await fetchRecentTokens(
        collections,
        Math.min(collections.length * 8, 400),
    ).catch(() => []);
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
    collectionName: string;
    artist?: string;
    mintedAt?: string;
    /** Rendered image, once a provider has published one. */
    imageUrl?: string;
    /** The generator itself, framed live when there is no image yet. */
    artifactUrl?: string;
    /**
     * True while the piece still carries its collection's "not revealed yet"
     * document. The piece itself comes from chain state, and the metadata
     * describes it. See docs/decisions.md §4.
     */
    pending: boolean;
}

function toPiece(
    t: TzktToken,
    collectionAlias?: string,
    resolved?: TokenDoc,
    /** The collection's pending pointer, and this token's, when known. */
    pendingState?: { pendingUri: string; tokenUri?: string },
): FeedPiece {
    // TzKT's own `metadata` when it has it, and the document we fetched
    // ourselves when it does not. TzKT resolves `ipfs://` metadata on its own
    // schedule and on some networks never, so a piece finished on chain would
    // otherwise sit here looking unrendered indefinitely.
    const m = t.metadata ?? resolved;
    const display = m?.displayUri || m?.thumbnailUri;
    // Not "has no image". A collection's pending document carries the
    // collection cover as its displayUri, so every unrendered piece looked
    // rendered, wore the cover as its own image, and took the collection's
    // name for its own. The provider's queue rule is the pointer comparison,
    // and matching it here means the site and the daemon never disagree.
    const pending =
        pendingState?.pendingUri && pendingState.tokenUri
            ? pendingState.tokenUri === pendingState.pendingUri
            : !display;
    const collectionName = collectionAlias || t.contract.alias || "Untitled collection";
    const edition = `#${Number(t.tokenId) + 1}`;

    // A piece that has not been rendered carries its collection's *pending*
    // document, which is one CID shared by every unrevealed token in the
    // collection and therefore cannot name any of them. Taking its `name` gave
    // every piece the collection's name, so a whole edition read as one work
    // repeated. Derived here instead, in the form the real document uses, so
    // the name does not change when the render lands.
    const name = pending ? `${collectionName} ${edition}` : m?.name || edition;

    return {
        key: `${t.contract.address}:${t.tokenId}`,
        contract: t.contract.address,
        tokenId: t.tokenId,
        name,
        collectionName,
        artist: t.firstMinter?.address,
        mintedAt: t.firstTime,
        imageUrl: display ? ipfsImageUrl(display) : undefined,
        artifactUrl: m?.artifactUri ? ipfsImageUrl(m.artifactUri) : undefined,
        pending,
    };
}

/**
 * Turn a set of (collection, token) pairs into real pieces.
 *
 * The market knows which tokens are for sale and nothing else about them: a
 * listing carries a collection, a token id and a price. Everything a person
 * needs to decide whether they want it, the image, the name, who made it, is a
 * separate read, which is why the market page was a list of numbers.
 *
 * One query for the whole page. `contract.in` and `tokenId.in` are independent
 * filters rather than a set of pairs, so this over-fetches the cross product
 * and then keeps only the pairs actually asked for. At a page of listings that
 * is cheaper than one query per row by an order of magnitude.
 */
export async function piecesFor(
    pairs: { collection: string; tokenId: string }[],
    /** Collection names, when the caller already has them. */
    names?: Map<string, string>,
): Promise<Map<string, FeedPiece>> {
    if (pairs.length === 0) return new Map();

    const wanted = new Set(pairs.map((p) => `${p.collection}:${p.tokenId}`));
    const collections = [...new Set(pairs.map((p) => p.collection))];
    const tokenIds = [...new Set(pairs.map((p) => p.tokenId))];

    const tokens = (await fetchTokensIn(collections, tokenIds).catch(() => [])).filter((t) =>
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

export interface RecentFeed {
    pieces: FeedPiece[];
    collectionCount: number;
    /** True when no factory address is set. Distinct from a quiet feed. */
    unconfigured: boolean;
}

export async function fetchRecentFeed(limit = 48): Promise<RecentFeed> {
    const factories = await allFactories();
    if (factories.length === 0) {
        return { pieces: [], collectionCount: 0, unconfigured: true };
    }
    // Every factory, not just the current one. A redeploy retires a factory
    // and the collections it made stay real, so reading only the newest would
    // drop them off the site.
    //
    // The blocklist applied here too. It was on the wallet page and the market
    // and not on the front page, which is the one surface where it obviously
    // has to be.
    const collections = (await collectionsFrom(factories)).filter(
        (c) => !isBlockedCollection(c.address),
    );
    if (collections.length === 0) {
        return { pieces: [], collectionCount: 0, unconfigured: false };
    }
    const aliasByAddress = await namesFor(collections.map((c) => c.address));
    const tokens = await fetchRecentTokens(
        collections.map((c) => c.address),
        limit,
    );
    const [docs, state] = await Promise.all([docsFor(tokens), pendingState(tokens)]);
    return {
        pieces: tokens.map((t) =>
            toPiece(t, aliasByAddress.get(t.contract.address), docs.get(key(t)), state.get(key(t))),
        ),
        collectionCount: collections.length,
        unconfigured: false,
    };
}

export interface WalletView {
    /** Pieces this account holds now. */
    held: FeedPiece[];
    /** Collections this account deployed, as the collections wall shows them. */
    made: CollectionSummary[];
    unconfigured: boolean;
}

/**
 * One account, both ways round: what they hold and what they made.
 *
 * A single page for both because on this chain they are the same person as
 * often as not, and an artist's public page and a collector's public page would
 * otherwise be two views of one address.
 */
export async function fetchWallet(account: string, limit = 48): Promise<WalletView> {
    const factories = await allFactories();
    if (factories.length === 0) {
        return { held: [], made: [], unconfigured: true };
    }
    const collections = (await collectionsFrom(factories)).filter(
        (c) => !isBlockedCollection(c.address),
    );
    const aliasByAddress = await namesFor(collections.map((c) => c.address));
    const addresses = collections.map((c) => c.address);

    const [tokens, deployed] = await Promise.all([
        fetchTokensHeldBy(account, addresses, limit).catch(() => []),
        Promise.all(
            factories.map((f) => fetchCollectionsDeployedBy(account, f).catch(() => [])),
        ).then((lists) => lists.flat()),
    ]);

    const madeSet = new Set(deployed);
    const mine = collections.filter((c) => madeSet.has(c.address));
    const madeAddresses = mine.map((c) => c.address);

    // The made side is a handful of collections, not the whole chain, so the
    // cover, the edition size and the artist's own name are worth fetching:
    // this is the page their work is presented on.
    const [docs, state, metas, covers, editions] = await Promise.all([
        docsFor(tokens),
        pendingState(tokens),
        Promise.all(
            madeAddresses.map(
                (a): Promise<CollectionMeta> => fetchCollectionMeta(a).catch(() => ({})),
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
