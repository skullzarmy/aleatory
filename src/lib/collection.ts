/**
 * A collection, read from its own storage.
 */
import {
    fetchStorage,
    fetchRecentTokens,
    fetchTokenUris,
    type TokenMetadata,
    type TzktToken,
} from "./tzkt";
import {
    fetchCollections,
    fetchCollectionMeta,
    fetchEditionSizes,
    type CollectionMeta,
    indexerFetch,
} from "./tzkt";

export { fetchCollectionMeta, type CollectionMeta };
import { tzktApi } from "./config";
import { allFactories } from "./router";
import { isBlockedCollection } from "./blocklist";
import { bytesToString, convertIpfsToGatewayUrl, ipfsImageUrl } from "@/utils/ipfs";
import { coversFor, type FeedPiece } from "./feed";
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
    description?: string;
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

    const meta: CollectionMeta = await fetchCollectionMeta(address).catch(() => ({}));

    return {
        address,
        name: meta.name,
        description: meta.description,
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
 * A collection's total royalty, and nothing else.
 *
 * `fetchCollection` carries this already, but reading it that way pulls the
 * whole storage record, and `art.code` is the generator itself: around fifty
 * kilobytes for a number that fits in a word. TzKT's `path` selector returns
 * the one field, so a page showing what a seller receives can ask about several
 * collections without downloading several generators.
 *
 * Clamped nowhere here. `proceeds` applies the contract's 25% cap, so the
 * caller gets the declared figure and one place decides what it means.
 */
export async function fetchRoyaltyBps(address: string): Promise<number> {
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
 * The parameter declaration, from the collection's own metadata.
 *
 * Held under its own key so a mint UI needs one value rather than a whole
 * generator record, which is the difference between an integration someone
 * builds and one they skip. See docs/params.md §4.
 */
async function fetchParamsSchema(address: string): Promise<ParamsSchema | null> {
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

export async function fetchCollectionPieces(address: string, limit = 48): Promise<FeedPiece[]> {
    const tokens = await fetchRecentTokens([address], limit);

    // The chain's own pointers, for anything TzKT has not resolved. It fetches
    // `ipfs://` metadata on its own schedule and on some networks never, and a
    // piece finished on chain should not sit here looking unrendered.
    const uris = await fetchTokenUris(address).catch(() => new Map<string, string>());
    const docs = new Map<string, TokenMetadata>();
    await Promise.all(
        tokens
            .filter((t) => !t.metadata?.displayUri && !t.metadata?.thumbnailUri)
            .map(async (t) => {
                const uri = uris.get(t.tokenId);
                if (!uri?.startsWith("ipfs://")) return;
                const doc = await fetch(convertIpfsToGatewayUrl(uri), {
                    next: { revalidate: 300 },
                    // A gateway that is slow must not hold the page open.
                    signal: AbortSignal.timeout(12_000),
                })
                    .then((r) => (r.ok ? (r.json() as Promise<TokenMetadata>) : null))
                    .catch(() => null);
                if (doc) docs.set(t.tokenId, doc);
            }),
    );

    return tokens.map((t: TzktToken) => {
        const m = t.metadata ?? docs.get(t.tokenId);
        const display = m?.displayUri || m?.thumbnailUri;
        return {
            key: `${address}:${t.tokenId}`,
            contract: address,
            tokenId: t.tokenId,
            name: m?.name || `#${Number(t.tokenId) + 1}`,
            collectionName: t.contract.alias || "",
            artist: t.firstMinter?.address,
            mintedAt: t.firstTime,
            imageUrl: display ? ipfsImageUrl(display) : undefined,
            artifactUrl: m?.artifactUri ? ipfsImageUrl(m.artifactUri) : undefined,
            pending: !display,
        };
    });
}

export interface CollectionSummary {
    address: string;
    name?: string;
    description?: string;
    /**
     * The cover the artist chose at deploy, or the newest rendered piece when
     * a collection has none. Absent only when there is neither.
     */
    coverUrl?: string;
    minted: number;
    /** The cap. Zero is an open edition, which is what the contract means by it. */
    editionSize: number;
    firstActivity?: string;
}

export async function fetchAllCollections(): Promise<CollectionSummary[]> {
    const factories = await allFactories();
    if (factories.length === 0) return [];
    const lists = await Promise.all(factories.map((f) => fetchCollections(f).catch(() => [])));
    const seen = new Set<string>();
    const rows = lists
        .flat()
        .filter((c) => !seen.has(c.address) && (seen.add(c.address), true))
        .filter((c) => !isBlockedCollection(c.address));
    const addresses = rows.map((c) => c.address);
    const [metas, covers, editions] = await Promise.all([
        Promise.all(
            addresses.map((a): Promise<CollectionMeta> => fetchCollectionMeta(a).catch(() => ({}))),
        ),
        coversFor(addresses).catch(() => new Map<string, string>()),
        fetchEditionSizes(factories, addresses).catch(() => new Map<string, number>()),
    ]);

    return rows.map((c, i) => ({
        address: c.address,
        // The artist's own name for it. `alias` is TzKT's, which it sets for
        // contracts it happens to know and never for ours.
        name: metas[i].name || c.alias,
        description: metas[i].description,
        // The artist's own cover first. They picked it and we pinned it at
        // deploy, so a collection has a face from the moment it exists rather
        // than from whenever its first piece finishes rendering.
        coverUrl: (() => {
            const own = metas[i].displayUri ?? metas[i].thumbnailUri;
            return own ? ipfsImageUrl(own) : covers.get(c.address);
        })(),
        minted: c.tokensCount ?? 0,
        editionSize: editions.get(c.address) ?? 0,
        firstActivity: c.firstActivityTime,
    }));
}
