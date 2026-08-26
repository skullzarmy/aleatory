/**
 * A collection, read from its own storage.
 */
import { fetchStorage, fetchRecentTokens, type TzktToken } from "./tzkt";
import { fetchCollections } from "./tzkt";
import { CONTRACTS, tzktApi } from "./config";
import { bytesToString, convertIpfsToGatewayUrl } from "@/utils/ipfs";
import type { FeedPiece } from "./feed";
import type { ParamsSchema } from "./params";
import { decodeCode } from "./piece";

interface RawStorage {
    administrator: string;
    art: {
        code: string;
        code_encoding: string;
        code_uri: string;
        code_hash: string;
        royalties: Record<string, string>;
        pending_metadata: string;
    };
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

export interface Collection {
    address: string;
    artist: string;
    name?: string;
    /** The generator source, decoded from storage. Empty when it is a pointer. */
    code: string;
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
    /** Where writer authorisation is resolved from. Fixed at origination. */
    resolver: string;
    /** Whether the resolver's writers may publish metadata here. Artist's call. */
    trustResolver: boolean;
    royalties: { address: string; bps: number }[];
    royaltyTotalBps: number;
    /** Declared parameters, when the generator has any. */
    paramsSchema: ParamsSchema | null;
}

export async function fetchCollection(address: string): Promise<Collection | null> {
    const s = await fetchStorage<RawStorage>(address).catch(() => null);
    if (!s || !s.art) return null;

    const editionSize = parseInt(s.sale.edition_size, 10);
    const minted = parseInt(s.next_token_id, 10);
    const price = BigInt(s.sale.price);
    const gas = BigInt(s.render.render_gas);
    const royalties = Object.entries(s.art.royalties).map(([a, bps]) => ({
        address: a,
        bps: parseInt(String(bps), 10),
    }));

    return {
        address,
        paramsSchema: await fetchParamsSchema(address),
        artist: s.administrator,
        // The generator itself, out of storage. A viewer needs no gateway
        // and no pin to see it, which is the point of putting it there.
        code: await decodeCode(s.art.code, s.art.code_encoding).catch(() => ""),
        // `code_uri` is sp.string on chain, not sp.bytes, so it needs no
        // decoding. Set only for a generator too large to carry on chain.
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
        resolver: s.render.resolver,
        trustResolver: Boolean(s.render.trust_resolver),
        royalties,
        royaltyTotalBps: royalties.reduce((n, r) => n + r.bps, 0),
    };
}

/**
 * The parameter declaration, from the collection's own metadata.
 *
 * Held under its own key so a mint UI needs one value rather than a whole
 * generator record, which is the difference between an integration someone
 * builds and one they skip. See docs/params.md §4.
 */
async function fetchParamsSchema(address: string): Promise<ParamsSchema | null> {
    const rows = await fetch(
        `${tzktApi()}/v1/contracts/${address}/bigmaps/metadata/keys/aleatory%3Aparams`,
        { next: { revalidate: 300 } },
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
