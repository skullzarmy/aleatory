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
    fetchTokensHeldBy,
    fetchTokenUris,
    type TzktToken,
} from "./tzkt";
import { isBlockedCollection } from "./blocklist";
import { convertIpfsToGatewayUrl } from "@/utils/ipfs";

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
async function resolveDocs(
    collection: string,
    tokenIds: string[],
): Promise<Map<string, TokenDoc>> {
    const out = new Map<string, TokenDoc>();
    if (tokenIds.length === 0) return out;

    const uris = await fetchTokenUris(collection).catch(() => new Map<string, string>());
    await Promise.all(
        tokenIds.map(async (id) => {
            const uri = uris.get(id);
            if (!uri || !uri.startsWith("ipfs://")) return;
            const doc = await fetch(convertIpfsToGatewayUrl(uri), { next: { revalidate: 300 } })
                .then((r) => (r.ok ? (r.json() as Promise<TokenDoc>) : null))
                .catch(() => null);
            if (doc) out.set(id, doc);
        }),
    );
    return out;
}

const key = (t: TzktToken) => `${t.contract.address}:${t.tokenId}`;

/** Every collection from every factory, deduplicated. */
async function collectionsFrom(factories: string[]) {
    const lists = await Promise.all(
        factories.map((f) => fetchCollections(f).catch(() => [])),
    );
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
): FeedPiece {
    // TzKT's own `metadata` when it has it, and the document we fetched
    // ourselves when it does not. TzKT resolves `ipfs://` metadata on its own
    // schedule and on some networks never, so a piece finished on chain would
    // otherwise sit here looking unrendered indefinitely.
    const m = t.metadata ?? resolved;
    const display = m?.displayUri || m?.thumbnailUri;
    const pending = !display;
    return {
        key: `${t.contract.address}:${t.tokenId}`,
        contract: t.contract.address,
        tokenId: t.tokenId,
        name: m?.name || `#${Number(t.tokenId) + 1}`,
        collectionName: collectionAlias || t.contract.alias || "Untitled collection",
        artist: t.firstMinter?.address,
        mintedAt: t.firstTime,
        imageUrl: display ? convertIpfsToGatewayUrl(display) : undefined,
        artifactUrl: m?.artifactUri ? convertIpfsToGatewayUrl(m.artifactUri) : undefined,
        pending,
    };
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
    const aliasByAddress = new Map(
        collections.map((c) => [c.address, c.alias] as const),
    );
    const tokens = await fetchRecentTokens(
        collections.map((c) => c.address),
        limit,
    );
    const docs = await docsFor(tokens);
    return {
        pieces: tokens.map((t) =>
            toPiece(t, aliasByAddress.get(t.contract.address), docs.get(key(t))),
        ),
        collectionCount: collections.length,
        unconfigured: false,
    };
}

export interface WalletView {
    /** Pieces this account holds now. */
    held: FeedPiece[];
    /** Collections this account deployed. */
    made: { address: string; name?: string; minted: number }[];
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
    const aliasByAddress = new Map(collections.map((c) => [c.address, c.alias] as const));
    const addresses = collections.map((c) => c.address);

    const [tokens, deployed] = await Promise.all([
        fetchTokensHeldBy(account, addresses, limit).catch(() => []),
        Promise.all(
            factories.map((f) => fetchCollectionsDeployedBy(account, f).catch(() => [])),
        ).then((lists) => lists.flat()),
    ]);

    const madeSet = new Set(deployed);
    const docs = await docsFor(tokens);
    return {
        held: tokens.map((t) =>
            toPiece(t, aliasByAddress.get(t.contract.address), docs.get(key(t))),
        ),
        made: collections
            .filter((c) => madeSet.has(c.address))
            .map((c) => ({ address: c.address, name: c.alias, minted: c.tokensCount ?? 0 })),
        unconfigured: false,
    };
}
