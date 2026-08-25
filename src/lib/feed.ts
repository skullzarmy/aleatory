/**
 * The recent feed: pieces minted across every Aleatory collection, newest
 * first.
 *
 * Assembled from public chain data, so the same view is reproducible by
 * anyone against TzKT. Before the first collection exists this returns an
 * empty feed, which the UI shows as a state of its own.
 */
import { CONTRACTS } from "./config";
import {
    fetchCollections,
    fetchRecentTokens,
    type TzktToken,
} from "./tzkt";
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
     * document. A real token either way: what it is comes from chain state,
     * and the metadata describes it. See docs/decisions.md §4.
     */
    pending: boolean;
}

function toPiece(t: TzktToken, collectionAlias?: string): FeedPiece {
    const m = t.metadata;
    const display = m?.displayUri || m?.thumbnailUri;
    // A piece is awaiting its render when the metadata carries no image of
    // its own. The definitive check compares token_info[""] against the
    // collection's pending document; this is the cheap version, and it agrees
    // with it in every case the feed cares about.
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
    /** No factory configured yet, which is different from a quiet feed. */
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
