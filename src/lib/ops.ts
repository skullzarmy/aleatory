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

/**
 * What an operation declares, so nothing has to estimate it.
 *
 * Estimation does not work on this chain. `hard_gas_limit_per_operation`
 * equals the per-*block* limit, so a simulation submitted at the operation
 * maximum, which is what every estimator does, is refused by the node before
 * it ever reaches the contract. The error it comes back with is whatever the
 * simulator hit first and is usually misleading: `non_existing_contract`, for
 * a contract that plainly exists.
 *
 * Declaring limits skips the simulation entirely. The fee has to be derived
 * from the gas limit rather than guessed, because a baker's minimum is roughly
 * 100 + 0.1 per gas unit + 1 per byte, in mutez, charged against the limit
 * *declared* and not the gas consumed. Paying under it does not fail loudly:
 * the operation injects, returns a hash, and sits in the mempool until it
 * expires.
 *
 * Unused gas is not charged, so these are generous rather than tight.
 */
interface Limits {
    gas: number;
    storage: number;
    /**
     * Payload size, for the fee floor's per-byte term.
     *
     * Defaulted, because almost every operation here carries a few hundred
     * bytes of parameters. A deploy carrying a generator does not, and
     * assuming it did left the fee thousands of mutez short: the operation
     * injected, returned a hash, and sat in the mempool until it expired.
     */
    bytes?: number;
}

/** Creating a token: ledger, token_metadata, and two payouts. */
const MINT: Limits = { gas: 90_000, storage: 700 };
/** A big_map write or a small storage change. */
const SMALL: Limits = { gas: 30_000, storage: 400 };
/** Moving a token, which touches the ledger and an operator set. */
const TRANSFER: Limits = { gas: 60_000, storage: 500 };
/**
 * Escrowing a token into the marketplace: a listing row here, and an
 * inter-contract transfer that writes the collection's ledger and clears an
 * operator.
 */
const LIST: Limits = { gas: 120_000, storage: 1_000 };

/**
 * Storage a collection origination needs, beyond the generator itself.
 *
 * Measured, not guessed: a deploy carrying a 12,378-byte generator consumed
 * 27,297 bytes, so the contract's own code, its metadata and its initial
 * storage account for roughly 15,000. The default of 400 was not close, and
 * the failure is a wallet error rather than anything this app can catch.
 */
const ORIGINATION_OVERHEAD_BYTES = 20_000;

function feeFor(limits: Limits): number {
    // A baker's floor is about 100 + 0.1 per gas unit + 1 per byte, in mutez,
    // charged against what is *declared*. Underpaying does not fail loudly.
    return 100 + Math.ceil(limits.gas * 0.1) + (limits.bytes ?? 500);
}

async function send(
    client: DAppClient,
    destination: string,
    entrypoint: string,
    value: unknown,
    amountMutez: number | bigint = 0,
    limits: Limits = SMALL,
): Promise<OpResult> {
    const result = await client.requestOperation({
        operationDetails: [
            {
                kind: "transaction" as TezosOperationType.TRANSACTION,
                destination,
                amount: String(amountMutez),
                parameters: { entrypoint, value: value as never },
                fee: String(feeFor(limits)),
                gas_limit: String(limits.gas),
                storage_limit: String(limits.storage),
            } as never,
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
    return send(client, collection, "mint", bytes(utf8ToHex(params)), totalMutez, MINT);
}

/** Grant the marketplace the right to move one token, which listing needs. */
export async function addOperator(
    client: DAppClient,
    collection: string,
    owner: string,
    operator: string,
    tokenId: string,
): Promise<OpResult> {
    const p = await encode(collection, "update_operators", [
        { add_operator: { owner, operator, token_id: tokenId } },
    ]);
    return send(client, collection, p.entrypoint, p.value, 0, TRANSFER);
}

/**
 * Encode an entrypoint against the contract's own type, by field name.
 *
 * Hand-built Michelson pairs are positional, and SmartPy lays a record out in
 * alphabetical order rather than declaration order. `list_token(collection,
 * token_id, price)` is `(collection, price, token_id)` on chain, so a
 * positional encoding silently passed the price as the token id: listing at
 * 1 tez asked to transfer token 1,000,000, and the collection rightly answered
 * FA2_TOKEN_UNDEFINED.
 *
 * Nothing here builds a pair by hand any more. Taquito reads the type off the
 * chain and matches on names, so a field reordering cannot go unnoticed.
 */
async function encode(
    contractAddress: string,
    entrypoint: string,
    /** Named fields, or a list for an entrypoint that takes one. */
    args: Record<string, unknown> | unknown[],
): Promise<{ entrypoint: string; value: unknown }> {
    const { TezosToolkit } = await import("@taquito/taquito");
    const c = await new TezosToolkit(rpcUrl()).contract.at(contractAddress);
    const methods = c.methodsObject as unknown as Record<
        string,
        (a: unknown) => { toTransferParams: () => { parameter?: { entrypoint: string; value: unknown } } }
    >;
    const parameter = methods[entrypoint](args).toTransferParams().parameter;
    if (!parameter) throw new Error(`${entrypoint} encoded to nothing.`);
    return parameter;
}

export async function listToken(
    client: DAppClient,
    collection: string,
    tokenId: string,
    priceMutez: bigint,
): Promise<OpResult> {
    const market = await marketplace();
    const p = await encode(market, "list_token", {
        collection,
        token_id: tokenId,
        price: priceMutez.toString(),
    });
    return send(client, market, p.entrypoint, p.value, 0, LIST);
}

export async function delist(client: DAppClient, listingId: number): Promise<OpResult> {
    return send(client, await marketplace(), "delist", int(listingId));
}

export async function buyListing(
    client: DAppClient,
    listingId: number,
    priceMutez: bigint,
): Promise<OpResult> {
    return send(client, await marketplace(), "buy", int(listingId), priceMutez, TRANSFER);
}

export async function makeOffer(
    client: DAppClient,
    collection: string,
    tokenId: string,
    amountMutez: bigint,
): Promise<OpResult> {
    const market = await marketplace();
    const p = await encode(market, "make_offer", { collection, token_id: tokenId });
    return send(client, market, p.entrypoint, p.value, amountMutez, TRANSFER);
}

export async function cancelOffer(client: DAppClient, offerId: number): Promise<OpResult> {
    return send(client, await marketplace(), "cancel_offer", int(offerId));
}

export async function acceptOffer(client: DAppClient, offerId: number): Promise<OpResult> {
    return send(client, await marketplace(), "accept_offer", int(offerId), 0, TRANSFER);
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
export async function setProvider(
    client: DAppClient,
    collection: string,
    provider: string,
    maxPriceMutez: bigint,
): Promise<OpResult> {
    const p = await encode(collection, "set_provider", {
        provider,
        max_price: maxPriceMutez.toString(),
    });
    return send(client, collection, p.entrypoint, p.value);
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

    // The generator travels inside this operation and lands in the originated
    // contract's storage, so both the storage limit and the fee have to scale
    // with it. Neither is knowable by simulation on a chain whose per-operation
    // gas cap equals the per-block one.
    const codeBytes = Math.ceil(params.codeHex.replace(/^0x/, "").length / 2);
    const limits: Limits = {
        gas: 60_000,
        storage: codeBytes + ORIGINATION_OVERHEAD_BYTES,
        bytes: codeBytes + 2_000,
    };

    return send(
        client,
        factory,
        parameter.entrypoint,
        parameter.value,
        transfer.amount ?? 0,
        limits,
    );
}
