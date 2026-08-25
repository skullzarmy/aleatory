/**
 * A collection, read from its own storage.
 */
import { fetchStorage, fetchRecentTokens, type TzktToken } from "./tzkt";
import { fetchCollections } from "./tzkt";
import { CONTRACTS } from "./config";
import { bytesToString, convertIpfsToGatewayUrl } from "@/utils/ipfs";
import type { FeedPiece } from "./feed";

interface RawStorage {
    administrator: string;
    art: {
        code_uri: string;
        code_hash: string;
        royalties: Record<string, string>;
        pending_metadata: string;
    };
    sale: { price: string; edition_size: string; paused: boolean };
    render: { provider: string; render_gas: string; provider_agent: string };
    next_token_id: string;
    metadata: number;
}

export interface Collection {
    address: string;
    artist: string;
    name?: string;
    codeUri: string;
    codeHash: string;
    priceMutez: number;
    renderGasMutez: number;
    /** Price plus render gas: what a collector signs for. */
    totalMutez: number;
    editionSize: number;
    minted: number;
    paused: boolean;
    soldOut: boolean;
    provider: string;
    royalties: { address: string; bps: number }[];
    royaltyTotalBps: number;
}

export async function fetchCollection(address: string): Promise<Collection | null> {
    const s = await fetchStorage<RawStorage>(address).catch(() => null);
    if (!s || !s.art) return null;

    const editionSize = parseInt(s.sale.edition_size, 10);
    const minted = parseInt(s.next_token_id, 10);
    const price = parseInt(s.sale.price, 10);
    const gas = parseInt(s.render.render_gas, 10);
    const royalties = Object.entries(s.art.royalties).map(([a, bps]) => ({
        address: a,
        bps: parseInt(String(bps), 10),
    }));

    return {
        address,
        artist: s.administrator,
        codeUri: bytesToString(s.art.code_uri) || s.art.code_uri,
        codeHash: s.art.code_hash,
        priceMutez: price,
        renderGasMutez: gas,
        totalMutez: price + gas,
        editionSize,
        minted,
        paused: s.sale.paused,
        soldOut: editionSize > 0 && minted >= editionSize,
        provider: s.render.provider,
        royalties,
        royaltyTotalBps: royalties.reduce((n, r) => n + r.bps, 0),
    };
}

export async function fetchCollectionPieces(
    address: string,
    limit = 48,
): Promise<FeedPiece[]> {
    const tokens = await fetchRecentTokens([address], limit);
    return tokens.map((t: TzktToken) => {
        const m = t.metadata;
        const display = m?.displayUri || m?.thumbnailUri;
        return {
            key: `${address}:${t.tokenId}`,
            contract: address,
            tokenId: t.tokenId,
            name: m?.name || `#${Number(t.tokenId) + 1}`,
            collectionName: t.contract.alias || "",
            artist: t.firstMinter?.address,
            mintedAt: t.firstTime,
            imageUrl: display ? convertIpfsToGatewayUrl(display) : undefined,
            artifactUrl: m?.artifactUri ? convertIpfsToGatewayUrl(m.artifactUri) : undefined,
            pending: !display,
        };
    });
}

export interface CollectionSummary {
    address: string;
    name?: string;
    minted: number;
    firstActivity?: string;
}

export async function fetchAllCollections(): Promise<CollectionSummary[]> {
    if (!CONTRACTS.factory) return [];
    const rows = await fetchCollections(CONTRACTS.factory);
    return rows.map((c) => ({
        address: c.address,
        name: c.alias,
        minted: c.tokensCount ?? 0,
        firstActivity: c.firstActivityTime,
    }));
}
