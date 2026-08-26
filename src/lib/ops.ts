/**
 * Every write this app makes, in one file.
 *
 * Each function builds a single operation and hands it to the wallet. Reading
 * this file tells you the complete set of things the site can ask a visitor
 * to sign.
 */
import type { DAppClient, TezosOperationType } from "@tezos-x/octez.connect-sdk";
import { rpcUrl } from "./config";
import { addresses, currentFactory } from "./router";

interface OpResult {
    hash: string;
}

async function send(
    client: DAppClient,
    destination: string,
    entrypoint: string,
    value: unknown,
    amountMutez: number | bigint = 0,
): Promise<OpResult> {
    const result = await client.requestOperation({
        operationDetails: [
            {
                kind: "transaction" as TezosOperationType.TRANSACTION,
                destination,
                amount: String(amountMutez),
                parameters: { entrypoint, value: value as never },
            },
        ],
    });
    return { hash: (result as { transactionHash: string }).transactionHash };
}

const str = (v: string) => ({ string: v });
const int = (v: number | string | bigint) => ({ int: String(v) });
const bytes = (hex: string) => ({ bytes: hex.replace(/^0x/, "") });

/** Resolved from the router, so a redeploy does not need a rebuild. */
async function marketplace(): Promise<string> {
    const a = (await addresses()).marketplace;
    if (!a) throw new Error("No marketplace is configured for this network.");
    return a;
}

export function utf8ToHex(s: string): string {
    return Array.from(new TextEncoder().encode(s))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Mint one edition. The collector's single signature.
 *
 * The amount covers the price and the render gas together, and this
 * operation's hash becomes the piece's seed.
 *
 * `mint` on a collection creates a token. `buyListing` below buys one that
 * already exists. Those are different things and they no longer share a name.
 */
export function mint(
    client: DAppClient,
    collection: string,
    params: string,
    totalMutez: bigint,
): Promise<OpResult> {
    return send(client, collection, "mint", bytes(utf8ToHex(params)), totalMutez);
}

/** Grant the marketplace the right to move one token, which listing needs. */
export function addOperator(
    client: DAppClient,
    collection: string,
    owner: string,
    operator: string,
    tokenId: string,
): Promise<OpResult> {
    return send(client, collection, "update_operators", [
        {
            prim: "Left",
            args: [
                {
                    prim: "Pair",
                    args: [str(owner), { prim: "Pair", args: [str(operator), int(tokenId)] }],
                },
            ],
        },
    ]);
}

export async function listToken(
    client: DAppClient,
    collection: string,
    tokenId: string,
    priceMutez: bigint,
): Promise<OpResult> {
    return send(client, await marketplace(), "list_token", {
        prim: "Pair",
        args: [str(collection), { prim: "Pair", args: [int(tokenId), int(priceMutez)] }],
    });
}

export async function delist(client: DAppClient, listingId: number): Promise<OpResult> {
    return send(client, await marketplace(), "delist", int(listingId));
}

export async function buyListing(
    client: DAppClient,
    listingId: number,
    priceMutez: bigint,
): Promise<OpResult> {
    return send(client, await marketplace(), "buy", int(listingId), priceMutez);
}

export async function makeOffer(
    client: DAppClient,
    collection: string,
    tokenId: string,
    amountMutez: bigint,
): Promise<OpResult> {
    return send(
        client,
        await marketplace(),
        "make_offer",
        { prim: "Pair", args: [str(collection), int(tokenId)] },
        amountMutez,
    );
}

export async function cancelOffer(client: DAppClient, offerId: number): Promise<OpResult> {
    return send(client, await marketplace(), "cancel_offer", int(offerId));
}

export async function acceptOffer(client: DAppClient, offerId: number): Promise<OpResult> {
    return send(client, await marketplace(), "accept_offer", int(offerId));
}

/** Artist controls on their own collection. */
export function setPaused(
    client: DAppClient,
    collection: string,
    paused: boolean,
): Promise<OpResult> {
    return send(client, collection, "set_paused", { prim: paused ? "True" : "False" });
}

export function setPrice(
    client: DAppClient,
    collection: string,
    priceMutez: bigint,
): Promise<OpResult> {
    return send(client, collection, "set_price", int(priceMutez));
}

export function setEditionSize(
    client: DAppClient,
    collection: string,
    size: number,
): Promise<OpResult> {
    return send(client, collection, "set_edition_size", int(size));
}

/**
 * Switch who renders this collection's images.
 *
 * `maxPriceMutez` is the artist's ceiling. The contract reads the provider's
 * live price and fails if it exceeds this, so a provider that raises their
 * price between the quote on screen and the signature cannot silently charge
 * more.
 */
export function setProvider(
    client: DAppClient,
    collection: string,
    provider: string,
    maxPriceMutez: bigint,
): Promise<OpResult> {
    return send(client, collection, "set_provider", {
        prim: "Pair",
        args: [str(provider), int(maxPriceMutez)],
    });
}

/** Let Aleatory's keys publish metadata for unrevealed pieces, or stop them. */
export function setTrustResolver(
    client: DAppClient,
    collection: string,
    trusted: boolean,
): Promise<OpResult> {
    return send(client, collection, "set_trust_resolver", {
        prim: trusted ? "True" : "False",
    });
}

// ---------------------------------------------------------------------------
// Deploying a collection
// ---------------------------------------------------------------------------

export interface DeployParams {
    /**
     * The generator itself, hex, no prefix. This is the normal case: the art
     * goes into contract storage and depends on nobody's gateway.
     */
    codeHex: string;
    /** How `codeHex` is encoded. `identity` unless it needed compressing. */
    codeEncoding: "identity" | "gzip";
    /** SHA-256 of the DECODED source, hex, no prefix. */
    codeHashHex: string;
    /** Only for a generator past the operation cap. Empty when `codeHex` is set. */
    codeUri: string;
    /** 0 for an open edition. */
    editionSize: number;
    priceMutez: bigint;
    /** Address to basis points. The contract caps the total at 2500. */
    royalties: Record<string, number>;
    /** `ipfs://` pointer to the document every piece mints carrying. */
    pendingMetadataUri: string;
    startPaused: boolean;
    trustResolver: boolean;
    provider: string;
    /** The artist's ceiling on the provider's per-piece charge. */
    maxRenderGasMutez: bigint;
    /** TZIP-016 contract metadata, key to UTF-8 string. */
    metadata: Record<string, string>;
}

/**
 * Originate a collection through the factory. The artist's one signature.
 *
 * The parameter is encoded by Taquito against the factory's own type read from
 * the chain, rather than assembled by hand here. A record's Michelson layout
 * sorts its fields, and a map's keys have to be in the protocol's order for
 * their type, which for addresses is their binary form and not their text. Both
 * are easy to get wrong in a way that is invisible until an artist's signature
 * is rejected, and neither has to be guessed when the type is public.
 *
 * The caller is written in as administrator in the collection's initial
 * storage, so nothing passes through us, and the storage burn is charged to the
 * artist's own wallet. The wallet estimates the storage limit: anything
 * hardcoded breaks the day the template grows.
 */
export async function deployCollection(
    client: DAppClient,
    params: DeployParams,
): Promise<OpResult> {
    const factory = await currentFactory();
    if (!factory) throw new Error("No factory is configured for this network.");

    const { TezosToolkit, MichelsonMap } = await import("@taquito/taquito");
    const contract = await new TezosToolkit(rpcUrl()).contract.at(factory);

    const royalties = new MichelsonMap<string, number>();
    for (const [address, bps] of Object.entries(params.royalties)) {
        if (bps > 0) royalties.set(address, bps);
    }

    const metadata = new MichelsonMap<string, string>();
    for (const [key, value] of Object.entries(params.metadata)) {
        metadata.set(key, utf8ToHex(value));
    }

    const transfer = contract.methodsObject
        .deploy({
            code: params.codeHex.replace(/^0x/, ""),
            code_encoding: params.codeEncoding,
            code_hash: params.codeHashHex.replace(/^0x/, ""),
            code_uri: params.codeUri,
            edition_size: params.editionSize,
            price: params.priceMutez.toString(),
            royalties,
            pending_metadata: utf8ToHex(params.pendingMetadataUri),
            start_paused: params.startPaused,
            trust_resolver: params.trustResolver,
            provider: params.provider,
            max_render_gas: params.maxRenderGasMutez.toString(),
            metadata,
        })
        .toTransferParams();

    const parameter = transfer.parameter;
    if (!parameter) throw new Error("The factory's deploy entrypoint encoded to nothing.");

    return send(
        client,
        factory,
        parameter.entrypoint,
        parameter.value,
        transfer.amount ?? 0,
    );
}
