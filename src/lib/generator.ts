/**
 * A generator, read from its own storage.
 */
import {
    fetchStorage,
    fetchRecentTokens,
    fetchTokenUris,
    type TokenMetadata,
    type TzktToken,
} from "./tzkt";
import {
    fetchGenerators,
    fetchGeneratorMeta,
    fetchEditionSizes,
    type GeneratorMeta,
    indexerFetch,
} from "./tzkt";

export { fetchGeneratorMeta, type GeneratorMeta };
import { tzktApi } from "./config";
import { allFactories } from "./router";
import { isBlockedGenerator } from "./blocklist";
import {
    bytesToString,
    convertIpfsToGatewayUrl,
    GATEWAY_TIMEOUT_MS,
    ipfsImageUrl,
} from "@/utils/ipfs";
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

export interface Generator {
    address: string;
    artist: string;
    name?: string;
    description?: string;
    /** The source, decoded from storage. Empty when it is a pointer. */
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

export async function fetchGenerator(address: string): Promise<Generator | null> {
    const s = await fetchStorage<RawStorage>(address).catch(() => null);
    if (!s || !s.art) return null;

    const editionSize = parseInt(s.sale.edition_size, 10);
    const minted = parseInt(s.next_token_id, 10);
    const price = BigInt(s.sale.price);

    // The provider's price now, which is what the contract asks them for. The
    // recorded price is what they charged when they were chosen, and stands in
    // when they cannot be reached.
    const quoted = await fetchProviderGas(s.render.provider);
    const gas = quoted ?? BigInt(s.render.render_gas);
    const royalties = Object.entries(s.art.royalties).map(([a, bps]) => ({
        address: a,
        bps: parseInt(String(bps), 10),
    }));

    const meta: GeneratorMeta = await fetchGeneratorMeta(address).catch(() => ({}));

    return {
        address,
        name: meta.name,
        description: meta.description,
        paramsSchema: await fetchParamsSchema(address),
        artist: s.administrator,
        code: await decodeCode(s.art.code, s.art.code_encoding).catch(() => ""),
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
        providerReachable: quoted !== null,
        resolver: s.render.resolver,
        trustResolver: Boolean(s.render.trust_resolver),
        royalties,
        royaltyTotalBps: royalties.reduce((n, r) => n + r.bps, 0),
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

export async function fetchGeneratorPieces(address: string, limit = 48): Promise<FeedPiece[]> {
    const tokens = await fetchRecentTokens([address], limit);

    // The chain's own pointers, for anything TzKT has not resolved. It fetches
    // `ipfs://` metadata on its own schedule and on some networks never.
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
                    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
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
            generatorName: t.contract.alias || "",
            artist: t.firstMinter?.address,
            mintedAt: t.firstTime,
            imageUrl: display ? ipfsImageUrl(display) : undefined,
            artifactUrl: m?.artifactUri ? ipfsImageUrl(m.artifactUri) : undefined,
            pending: !display,
        };
    });
}

export interface GeneratorSummary {
    address: string;
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
}

export async function fetchAllGenerators(): Promise<GeneratorSummary[]> {
    const factories = await allFactories();
    if (factories.length === 0) return [];
    const lists = await Promise.all(factories.map((f) => fetchGenerators(f).catch(() => [])));
    const seen = new Set<string>();
    const rows = lists
        .flat()
        .filter((c) => !seen.has(c.address) && (seen.add(c.address), true))
        .filter((c) => !isBlockedGenerator(c.address))
        // Each factory's list is newest first, so flattening leaves one run per
        // factory rather than one order.
        .sort((a, b) => (b.firstActivityTime ?? "").localeCompare(a.firstActivityTime ?? ""));
    const addresses = rows.map((c) => c.address);
    const [metas, covers, editions] = await Promise.all([
        Promise.all(
            addresses.map((a): Promise<GeneratorMeta> => fetchGeneratorMeta(a).catch(() => ({}))),
        ),
        coversFor(addresses).catch(() => new Map<string, string>()),
        fetchEditionSizes(factories, addresses).catch(() => new Map<string, number>()),
    ]);

    return rows.map((c, i) => ({
        address: c.address,
        // `alias` is TzKT's, set for contracts it happens to know.
        name: metas[i].name || c.alias,
        description: metas[i].description,
        // The artist's own cover first, pinned at deploy, so a generator has a
        // face before its first piece finishes rendering.
        coverUrl: (() => {
            const own = metas[i].displayUri ?? metas[i].thumbnailUri;
            return own ? ipfsImageUrl(own) : covers.get(c.address);
        })(),
        minted: c.tokensCount ?? 0,
        editionSize: editions.get(c.address) ?? 0,
        firstActivity: c.firstActivityTime,
    }));
}
