/**
 * The recent feed: pieces minted across every Aleatory collection, newest
 * first. Assembled from public chain data, so anyone can reproduce it against
 * TzKT.
 */
import { CONTRACTS } from "./config";
import {
    fetchCollections,
    fetchCollectionsDeployedBy,
    fetchRecentTokens,
    fetchTokensHeldBy,
    type TzktToken,
} from "./tzkt";
import { isBlockedCollection } from "./blocklist";
import { convertIpfsToGatewayUrl } from "@/utils/ipfs";

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

function toPiece(t: TzktToken, collectionAlias?: string): FeedPiece {
    const m = t.metadata;
    const display = m?.displayUri || m?.thumbnailUri;
    // A piece is awaiting its render when its metadata carries no image.
    // The exact check compares token_info[""] against the collection's
    // pending document, which matters on a piece page. For a feed row this
    // is equivalent and costs one fewer request.
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
    if (!CONTRACTS.factory) {
        return { pieces: [], collectionCount: 0, unconfigured: true };
    }
    const collections = await fetchCollections(CONTRACTS.factory);
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
    return {
        pieces: tokens.map((t) => toPiece(t, aliasByAddress.get(t.contract.address))),
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
    if (!CONTRACTS.factory) {
        return { held: [], made: [], unconfigured: true };
    }
    const collections = (await fetchCollections(CONTRACTS.factory)).filter(
        (c) => !isBlockedCollection(c.address),
    );
    const aliasByAddress = new Map(collections.map((c) => [c.address, c.alias] as const));
    const addresses = collections.map((c) => c.address);

    const [tokens, deployed] = await Promise.all([
        fetchTokensHeldBy(account, addresses, limit).catch(() => []),
        fetchCollectionsDeployedBy(account, CONTRACTS.factory).catch(() => []),
    ]);

    const madeSet = new Set(deployed);
    return {
        held: tokens.map((t) => toPiece(t, aliasByAddress.get(t.contract.address))),
        made: collections
            .filter((c) => madeSet.has(c.address))
            .map((c) => ({ address: c.address, name: c.alias, minted: c.tokensCount ?? 0 })),
        unconfigured: false,
    };
}
