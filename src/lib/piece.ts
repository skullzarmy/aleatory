/**
 * One piece, assembled from chain state: the seed is the hash of the operation
 * that minted it, the parameters are in that same operation, and the code is
 * immutable in the generator's storage.
 */
import { CONTRACTS, ISOLATE_ORIGIN } from "./config";
import {
    fetchTokenUris,
    fetchToken,
    fetchOwner,
    fetchMintOperation,
    fetchStorage,
    type TokenMetadata,
} from "./tzkt";
import {
    bytesToString,
    convertIpfsToGatewayUrl,
    GATEWAY_TIMEOUT_MS,
    ipfsImageUrl,
} from "@/utils/ipfs";

/** The shape of a generator's storage that this page reads. */
interface GeneratorStorage {
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
    next_token_id: string;
}

export interface Piece {
    contract: string;
    tokenId: string;
    name: string;
    description?: string;
    generatorName?: string;
    artist: string;
    owner?: string;
    /** The buy operation hash. This is the seed. */
    seed?: string;
    mintedAt?: string;
    /** Canonical JSON of the collector's chosen parameters. */
    params?: string;
    /** The source, decoded from storage. Empty when it is a pointer. */
    code: string;
    codeUri: string;
    codeHash: string;
    /**
     * Whether `code` hashes to `codeHash`. False means the bytes here are not
     * the bytes the artist published, which for a pointer means the gateway.
     */
    codeVerified: boolean;
    editionSize: number;
    minted: number;
    /** Rendered image, once a provider has published one. */
    imageUrl?: string;
    /** The provider that rendered it, when the document says. */
    provider?: string;
    /** Live render of the generator, always available. */
    renderUrl?: string;
    pending: boolean;
    royalties: { address: string; bps: number }[];
    metadata?: TokenMetadata;
}

/**
 * The generator, decoded, from contract storage. `identity` is the normal case;
 * `gzip` is for a generator that would not otherwise fit one operation.
 */
export async function decodeCode(hex: string, encoding: string): Promise<string> {
    const clean = hex.replace(/^0x/, "");
    if (clean.length === 0) return "";
    const bytes = new Uint8Array((clean.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    if (encoding !== "gzip") return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
}

/** ALEATORY-001 §9.2, the check a viewer makes for the same reason a renderer does. */
export async function sourceMatches(code: string, codeHashHex: string): Promise<boolean> {
    const want = codeHashHex.replace(/^0x/, "").toLowerCase();
    if (!code || !/^[0-9a-f]{64}$/.test(want)) return false;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
    return (
        [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("") === want
    );
}

export function renderUrl(codeUri: string, seed?: string, params?: string): string {
    const u = new URL("/render", ISOLATE_ORIGIN);
    u.searchParams.set("code", codeUri);
    if (seed) u.searchParams.set("seed", seed);
    if (params) u.searchParams.set("params", params);
    return u.toString();
}

export async function fetchPiece(contract: string, tokenId: string): Promise<Piece | null> {
    const token = await fetchToken(contract, tokenId);
    if (!token) return null;

    const [owner, mint, storage] = await Promise.all([
        fetchOwner(contract, tokenId).catch(() => null),
        fetchMintOperation(contract, tokenId).catch(() => null),
        fetchStorage<GeneratorStorage>(contract).catch(() => null),
    ]);

    // The token's own metadata pointer, off chain state, which is what decides
    // whether a piece has been rendered. The provider's queue rule is the same
    // comparison, so the site and the daemon cannot disagree.
    const tokenUri = (await fetchTokenUris(contract).catch(() => new Map<string, string>())).get(
        tokenId,
    );

    let m = token.metadata;
    if (!m?.displayUri && !m?.thumbnailUri) {
        const uri = tokenUri;
        if (uri?.startsWith("ipfs://")) {
            m =
                (await fetch(convertIpfsToGatewayUrl(uri), {
                    next: { revalidate: 300 },
                    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
                })
                    .then((r) => (r.ok ? (r.json() as Promise<typeof m>) : null))
                    .catch(() => null)) ?? m;
        }
    }
    const display = m?.displayUri || m?.thumbnailUri;
    // sp.string on chain, so it needs no decoding. `pending_metadata` below is
    // sp.bytes and does.
    const codeUri = storage ? storage.art.code_uri : "";
    const code = storage
        ? await decodeCode(storage.art.code, storage.art.code_encoding).catch(() => "")
        : "";
    const pendingDoc = storage ? bytesToString(storage.art.pending_metadata) : "";

    const royalties = storage
        ? Object.entries(storage.art.royalties).map(([address, bps]) => ({
              address,
              bps: parseInt(String(bps), 10),
          }))
        : [];

    // "Has no image" is not the test: a pending document carries the
    // generator's cover as its displayUri.
    const pending = pendingDoc.length > 0 && tokenUri ? tokenUri === pendingDoc : !display;
    const edition = `#${Number(tokenId) + 1}`;

    // The pending document is one CID shared by every unrevealed token, so its
    // `name` is the generator's. Built here in the form the real document
    // uses, so the name does not change when the render lands.
    const generatorName = (pending ? m?.name : undefined) ?? token.contract.alias;
    const name = pending
        ? `${generatorName ?? "Untitled generator"} ${edition}`
        : m?.name || edition;

    return {
        contract,
        tokenId,
        name,
        description: m?.description,
        generatorName,
        artist: storage?.administrator || token.firstMinter?.address || "",
        owner: owner ?? undefined,
        seed: mint?.hash,
        mintedAt: mint?.timestamp ?? token.firstTime,
        // The operation the collector signed, ahead of the document a provider
        // writes later. Only the first exists in the minutes after a mint; only
        // the second survives an indexer that has forgotten the mint.
        params: mint?.params || m?.aleaParams,
        code,
        codeUri,
        codeHash: storage?.art.code_hash ?? "",
        codeVerified: await sourceMatches(code, storage?.art.code_hash ?? ""),
        editionSize: storage ? parseInt(storage.sale.edition_size, 10) : 0,
        minted: storage ? parseInt(storage.next_token_id, 10) : 0,
        imageUrl: display ? ipfsImageUrl(display) : undefined,
        provider: m?.aleaProvider,
        renderUrl: codeUri
            ? renderUrl(codeUri, mint?.hash, mint?.params || m?.aleaParams)
            : undefined,
        pending,
        royalties,
        metadata: m,
    };
}
