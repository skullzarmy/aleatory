/**
 * One piece, assembled from chain state.
 *
 * The seed is the hash of the operation that minted it, the parameters are in
 * that same operation, and the code is immutable in the collection's storage.
 * Those three determine the artwork, and this function collects them.
 */
import { CONTRACTS, SANDBOX_ORIGIN } from "./config";
import {
    fetchToken,
    fetchOwner,
    fetchMintOperation,
    fetchStorage,
    type TokenMetadata,
} from "./tzkt";
import { bytesToString, convertIpfsToGatewayUrl } from "@/utils/ipfs";

/** The shape of a collection's storage that this page reads. */
interface CollectionStorage {
    administrator: string;
    art: {
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
    codeUri: string;
    codeHash: string;
    editionSize: number;
    minted: number;
    /** Rendered image, once a provider has published one. */
    imageUrl?: string;
    /** Live render of the generator, always available. */
    renderUrl?: string;
    pending: boolean;
    royalties: { address: string; bps: number }[];
    metadata?: TokenMetadata;
}

/**
 * Where a piece renders. The sandbox host loads the generator, injects the
 * seed and parameters, and runs it. It is a separate origin from this app.
 */
export function renderUrl(codeUri: string, seed?: string, params?: string): string {
    const u = new URL("/render", SANDBOX_ORIGIN);
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

    const m = token.metadata;
    const display = m?.displayUri || m?.thumbnailUri;
    const codeUri = storage ? bytesToString(storage.art.code_uri) || storage.art.code_uri : "";
    const pendingDoc = storage ? bytesToString(storage.art.pending_metadata) : "";

    const royalties = storage
        ? Object.entries(storage.art.royalties).map(([address, bps]) => ({
              address,
              bps: parseInt(String(bps), 10),
          }))
        : [];

    return {
        contract,
        tokenId,
        name: m?.name || `#${Number(tokenId) + 1}`,
        description: m?.description,
        collectionName: token.contract.alias,
        artist: storage?.administrator || token.firstMinter?.address || "",
        owner: owner ?? undefined,
        seed: mint?.hash,
        mintedAt: mint?.timestamp ?? token.firstTime,
        params: m?.aleaParams,
        codeUri,
        codeHash: storage?.art.code_hash ?? "",
        editionSize: storage ? parseInt(storage.sale.edition_size, 10) : 0,
        minted: storage ? parseInt(storage.next_token_id, 10) : 0,
        imageUrl: display ? convertIpfsToGatewayUrl(display) : undefined,
        renderUrl: codeUri ? renderUrl(codeUri, mint?.hash, m?.aleaParams) : undefined,
        pending: pendingDoc.length > 0 && !display,
        royalties,
        metadata: m,
    };
}
