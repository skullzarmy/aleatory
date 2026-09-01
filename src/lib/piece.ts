/**
 * One piece, assembled from chain state.
 *
 * The seed is the hash of the operation that minted it, the parameters are in
 * that same operation, and the code is immutable in the collection's storage.
 * Those three determine the artwork, and this function collects them.
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
import { bytesToString, convertIpfsToGatewayUrl, ipfsImageUrl } from "@/utils/ipfs";

/** The shape of a collection's storage that this page reads. */
interface CollectionStorage {
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
    collectionName?: string;
    artist: string;
    owner?: string;
    /** The buy operation hash. This is the seed. */
    seed?: string;
    mintedAt?: string;
    /** Canonical JSON of the collector's chosen parameters. */
    params?: string;
    /** The generator source, decoded from storage. Empty when it is a pointer. */
    code: string;
    codeUri: string;
    codeHash: string;
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
 * Where a minted piece renders.
 *
 * The provider's render host loads the generator from its CID, injects the seed
 * and parameters, and runs it. Separate origin from this app on purpose: it is
 * executing code published by someone else.
 */
/**
 * The generator, decoded, from contract storage.
 *
 * `identity` is the normal case and needs nothing. `gzip` is for a generator
 * that would not otherwise fit one operation, and `DecompressionStream` is
 * native everywhere this runs, so decoding costs no dependency.
 */
export async function decodeCode(hex: string, encoding: string): Promise<string> {
    const clean = hex.replace(/^0x/, "");
    if (clean.length === 0) return "";
    const bytes = new Uint8Array(
        (clean.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );
    if (encoding !== "gzip") return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
}

export function renderUrl(codeUri: string, seed?: string, params?: string): string {
    const u = new URL("/render", ISOLATE_ORIGIN);
    u.searchParams.set("code", codeUri);
    if (seed) u.searchParams.set("seed", seed);
    if (params) u.searchParams.set("params", params);
    return u.toString();
}

export async function fetchPiece(
    contract: string,
    tokenId: string,
): Promise<Piece | null> {
    const token = await fetchToken(contract, tokenId);
    if (!token) return null;

    const [owner, mint, storage] = await Promise.all([
        fetchOwner(contract, tokenId).catch(() => null),
        fetchMintOperation(contract, tokenId).catch(() => null),
        fetchStorage<CollectionStorage>(contract).catch(() => null),
    ]);

    // TzKT's resolved document when it has one, and the chain's own pointer
    // when it does not. TzKT fetches `ipfs://` metadata on its own schedule
    // and on some networks never, so a piece finished on chain would sit here
    // looking unrendered indefinitely.
    // The token's own metadata pointer, off chain state. This is what decides
    // whether a piece has been rendered: the provider's queue rule is exactly
    // "does token_info[\"\"] still equal the collection's pending document",
    // and matching it here means the site and the daemon never disagree.
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
                    signal: AbortSignal.timeout(12_000),
                })
                    .then((r) => (r.ok ? (r.json() as Promise<typeof m>) : null))
                    .catch(() => null)) ?? m;
        }
    }
    const display = m?.displayUri || m?.thumbnailUri;
    // sp.string on chain, so it needs no decoding. `pending_metadata` below
    // is sp.bytes and does.
    const codeUri = storage ? storage.art.code_uri : "";
    // The generator itself, when it is on chain, which is the normal case.
    // A viewer needs no gateway and no pin to see the piece.
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

    // Not "has no image": the pending document carries the collection's cover
    // as its displayUri, so every unrendered piece looked rendered, showed the
    // cover as its own image, and took the collection's name for its own.
    const pending =
        pendingDoc.length > 0 && tokenUri ? tokenUri === pendingDoc : !display;
    const edition = `#${Number(tokenId) + 1}`;

    // While a piece is unrendered it carries the collection's pending
    // document, which is one CID shared by every unrevealed token and so
    // cannot name any of them: its `name` is the collection's. Taking it gave
    // a whole edition one name, as though it were the same work repeated.
    // Built here in the form the real document uses, so the name does not
    // change when the render lands.
    const collectionName = (pending ? m?.name : undefined) ?? token.contract.alias;
    const name = pending
        ? `${collectionName ?? "Untitled collection"} ${edition}`
        : m?.name || edition;

    return {
        contract,
        tokenId,
        name,
        description: m?.description,
        collectionName,
        artist: storage?.administrator || token.firstMinter?.address || "",
        owner: owner ?? undefined,
        seed: mint?.hash,
        mintedAt: mint?.timestamp ?? token.firstTime,
        params: m?.aleaParams,
        code,
        codeUri,
        codeHash: storage?.art.code_hash ?? "",
        editionSize: storage ? parseInt(storage.sale.edition_size, 10) : 0,
        minted: storage ? parseInt(storage.next_token_id, 10) : 0,
        imageUrl: display ? ipfsImageUrl(display) : undefined,
        provider: m?.aleaProvider,
        renderUrl: codeUri ? renderUrl(codeUri, mint?.hash, m?.aleaParams) : undefined,
        pending,
        royalties,
        metadata: m,
    };
}
