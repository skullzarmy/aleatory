/** Every write this app makes, and so every signature it can ask for. */
import type { DAppClient, TezosOperationType } from "@tezos-x/octez.connect-sdk";
import { rpcUrl, tzktApi } from "./config";
import { addresses, allFactories, currentFactory } from "./router";
import { indexerFetch } from "./tzkt";
import { feeFor } from "@provider/fees";

interface OpResult {
    hash: string;
}

/**
 * What an operation declares, so nothing has to estimate it.
 *
 * Estimation does not work on this chain. `hard_gas_limit_per_operation`
 * equals the per-block limit, so a simulation submitted at the operation
 * maximum, which is what every estimator does, is refused by the node before it
 * reaches the contract, under whatever error the simulator hit first.
 * `non_existing_contract`, for a contract that plainly exists, is the usual
 * one.
 *
 * A baker's fee floor is roughly 100 + 0.1 per gas unit + 1 per byte, in mutez,
 * charged against the limits declared here and not the gas consumed. Paying
 * under it is silent: the operation injects, returns a hash, and sits in the
 * mempool until it expires. Unused gas is not charged, so these are generous.
 */
interface Limits {
    gas: number;
    storage: number;
    /** Payload size, for the fee floor's per-byte term. */
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
 * inter-contract transfer that writes the generator's ledger and clears an
 * operator.
 */
const LIST: Limits = { gas: 120_000, storage: 1_000 };

/**
 * Storage a generator origination needs, beyond the source itself.
 *
 * Measured: a deploy carrying 12,378 bytes of source consumed 27,297 bytes, so
 * the contract's own code, its metadata and its initial storage account for
 * roughly 15,000. Getting it wrong surfaces as a wallet error, which this app
 * cannot catch.
 */
const ORIGINATION_OVERHEAD_BYTES = 20_000;

/**
 * The parameter's real serialized length, rather than a guess at it.
 *
 * The fee floor is charged per byte of the operation, and a generator's deploy
 * carries the artist's own metadata: a description they typed, a cover URI, a
 * params schema, a libraries record. A fixed allowance for all that is a number
 * that is right until somebody writes a long description.
 */
async function packedBytes(value: unknown): Promise<number> {
    const { packDataBytes } = await import("@taquito/michel-codec");
    return packDataBytes(value as never).bytes.length / 2;
}

interface Call {
    destination: string;
    entrypoint: string;
    value: unknown;
    amountMutez?: number | bigint;
    limits?: Limits;
}

const detail = (c: Call) => {
    const limits = c.limits ?? SMALL;
    return {
        kind: "transaction" as TezosOperationType.TRANSACTION,
        destination: c.destination,
        amount: String(c.amountMutez ?? 0),
        parameters: { entrypoint: c.entrypoint, value: c.value as never },
        fee: String(feeFor({ gas: limits.gas, bytes: limits.bytes ?? 500 })),
        gas_limit: String(limits.gas),
        storage_limit: String(limits.storage),
    } as never;
};

/**
 * Several calls, one signature, all or nothing. Tezos applies a batch
 * atomically, so a failure in the last call reverts the earlier ones, which is
 * what makes granting an operator and using the grant safe to send together.
 */
async function sendBatch(client: DAppClient, calls: Call[]): Promise<OpResult> {
    const result = await client.requestOperation({ operationDetails: calls.map(detail) });
    return { hash: (result as { transactionHash: string }).transactionHash };
}

async function send(
    client: DAppClient,
    destination: string,
    entrypoint: string,
    value: unknown,
    amountMutez: number | bigint = 0,
    limits: Limits = SMALL,
): Promise<OpResult> {
    return sendBatch(client, [{ destination, entrypoint, value, amountMutez, limits }]);
}

const str = (v: string) => ({ string: v });
const int = (v: number | string | bigint) => ({ int: String(v) });
const bytes = (hex: string) => ({ bytes: hex.replace(/^0x/, "") });

/**
 * Where a new listing or offer goes. Anything that already exists carries the
 * address of the marketplace it was made on, and acting on it takes that
 * address, because the wrong one fails after the wallet has asked to sign.
 */
async function marketplace(): Promise<string> {
    const a = (await addresses()).marketplaces[0];
    if (!a) throw new Error("No marketplace is configured for this network.");
    return a;
}

async function registry(): Promise<string> {
    const a = (await addresses()).registry;
    if (!a) throw new Error("No registry is configured for this network.");
    return a;
}

/**
 * List a provider contract, or take it off the list.
 *
 * Permissionless, and free: `register` refuses tez and asks nobody's
 * permission. It calls `get_render_gas`, `get_agent` and `get_operator` on the
 * contract and fails with NOT_A_PROVIDER when any of them does not answer, so
 * an address that could never be used cannot be listed. That is a type check
 * and not an endorsement, which the page says too.
 */
export async function registerProvider(client: DAppClient, provider: string): Promise<OpResult> {
    return send(client, await registry(), "register", str(provider), 0, SMALL);
}

export async function deregisterProvider(client: DAppClient, provider: string): Promise<OpResult> {
    return send(client, await registry(), "deregister", str(provider), 0, SMALL);
}

/** The operator's own controls, on a provider contract they administer. */
export function setRenderGas(
    client: DAppClient,
    provider: string,
    priceMutez: bigint,
): Promise<OpResult> {
    return send(client, provider, "set_render_gas", int(priceMutez));
}

export function setAgent(client: DAppClient, provider: string, agent: string): Promise<OpResult> {
    return send(client, provider, "set_agent", str(agent));
}

/**
 * Take earned tez out. The contract is paid per render and holds the balance
 * until the operator moves it, so this is the only way money leaves.
 */
export async function withdrawFromProvider(
    client: DAppClient,
    provider: string,
    amountMutez: bigint,
    to: string,
): Promise<OpResult> {
    const p = await encode(provider, "withdraw", { amount: amountMutez.toString(), to_: to });
    return send(client, provider, p.entrypoint, p.value, 0, TRANSFER);
}

export function utf8ToHex(s: string): string {
    return Array.from(new TextEncoder().encode(s))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Mint one edition. The amount covers the price and the render gas together,
 * and this operation's hash becomes the piece's seed.
 */
export function mint(
    client: DAppClient,
    generator: string,
    params: string,
    totalMutez: bigint,
): Promise<OpResult> {
    return send(client, generator, "mint", bytes(utf8ToHex(params)), totalMutez, MINT);
}

/** Grant the marketplace the right to move one token, which listing needs. */
export async function addOperator(
    client: DAppClient,
    generator: string,
    owner: string,
    operator: string,
    tokenId: string,
): Promise<OpResult> {
    const p = await encode(generator, "update_operators", [
        { add_operator: { owner, operator, token_id: tokenId } },
    ]);
    return send(client, generator, p.entrypoint, p.value, 0, TRANSFER);
}

/**
 * Encode an entrypoint against the contract's own type, by field name.
 *
 * Michelson pairs are positional and SmartPy lays a record out alphabetically,
 * so `list_token(collection, token_id, price)` is `(collection, price,
 * token_id)` on chain. Taquito reads the type off the chain and matches on
 * names, which is what keeps a field reordering from passing a price as a
 * token id.
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
        (a: unknown) => {
            toTransferParams: () => { parameter?: { entrypoint: string; value: unknown } };
        }
    >;
    const parameter = methods[entrypoint](args).toTransferParams().parameter;
    if (!parameter) throw new Error(`${entrypoint} encoded to nothing.`);
    return parameter;
}

/**
 * Grant, list, revoke. One signature, one operation.
 *
 * The marketplace escrows the token, which it can only do as an operator.
 * `list_token` transfers inside this same operation, so the grant is needed for
 * the length of one call: left standing it is open permission to move that
 * token again, on a token the marketplace no longer holds once the listing is
 * filled or cancelled.
 */
export async function listToken(
    client: DAppClient,
    generator: string,
    owner: string,
    tokenId: string,
    priceMutez: bigint,
): Promise<OpResult> {
    const market = await marketplace();
    const [grant, list, revoke] = await Promise.all([
        encode(generator, "update_operators", [
            { add_operator: { owner, operator: market, token_id: tokenId } },
        ]),
        encode(market, "list_token", {
            collection: generator,
            token_id: tokenId,
            price: priceMutez.toString(),
        }),
        encode(generator, "update_operators", [
            { remove_operator: { owner, operator: market, token_id: tokenId } },
        ]),
    ]);

    return sendBatch(client, [
        {
            destination: generator,
            entrypoint: grant.entrypoint,
            value: grant.value,
            limits: TRANSFER,
        },
        { destination: market, entrypoint: list.entrypoint, value: list.value, limits: LIST },
        {
            destination: generator,
            entrypoint: revoke.entrypoint,
            value: revoke.value,
            limits: TRANSFER,
        },
    ]);
}

/** Accept an offer, in one operation, for the same reasons as listing. */
export async function acceptOfferFor(
    client: DAppClient,
    generator: string,
    owner: string,
    tokenId: string,
    offerId: number,
    /** The marketplace holding the offer. The grant and the accept both name it. */
    market: string,
): Promise<OpResult> {
    const [grant, accept, revoke] = await Promise.all([
        encode(generator, "update_operators", [
            { add_operator: { owner, operator: market, token_id: tokenId } },
        ]),
        Promise.resolve({ entrypoint: "accept_offer", value: int(offerId) }),
        encode(generator, "update_operators", [
            { remove_operator: { owner, operator: market, token_id: tokenId } },
        ]),
    ]);

    return sendBatch(client, [
        {
            destination: generator,
            entrypoint: grant.entrypoint,
            value: grant.value,
            limits: TRANSFER,
        },
        { destination: market, entrypoint: accept.entrypoint, value: accept.value, limits: LIST },
        {
            destination: generator,
            entrypoint: revoke.entrypoint,
            value: revoke.value,
            limits: TRANSFER,
        },
    ]);
}

/**
 * Take a listing down and sell into an offer, in one operation.
 *
 * Listing escrows the token, and `accept_offer` transfers from the sender, so a
 * listed piece has nothing to move until the listing comes down. Split across
 * two signatures the seller is exposed between them, and the buyer can cancel
 * once the piece is back. Each call's internal operations run before the next
 * call begins, so the token is in the seller's hands by the time the accept
 * reaches for it, and a cancelled offer reverts all four.
 *
 * The listing and the offer can live in different marketplaces. Each call goes
 * to the contract holding the thing it acts on, and the grant names the one
 * doing the transfer.
 */
export async function delistAndAcceptOffer(
    client: DAppClient,
    generator: string,
    owner: string,
    tokenId: string,
    listingId: number,
    /** The marketplace holding the listing, from the listing. */
    listingMarket: string,
    offerId: number,
    /** The marketplace holding the offer, from the offer. */
    offerMarket: string,
): Promise<OpResult> {
    const [grant, revoke] = await Promise.all([
        encode(generator, "update_operators", [
            { add_operator: { owner, operator: offerMarket, token_id: tokenId } },
        ]),
        encode(generator, "update_operators", [
            { remove_operator: { owner, operator: offerMarket, token_id: tokenId } },
        ]),
    ]);

    return sendBatch(client, [
        { destination: listingMarket, entrypoint: "delist", value: int(listingId), limits: LIST },
        {
            destination: generator,
            entrypoint: grant.entrypoint,
            value: grant.value,
            limits: TRANSFER,
        },
        {
            destination: offerMarket,
            entrypoint: "accept_offer",
            value: int(offerId),
            limits: LIST,
        },
        {
            destination: generator,
            entrypoint: revoke.entrypoint,
            value: revoke.value,
            limits: TRANSFER,
        },
    ]);
}

export async function delist(
    client: DAppClient,
    listingId: number,
    /** The marketplace holding it, from the listing. */
    marketplaceAddress: string,
): Promise<OpResult> {
    return send(client, marketplaceAddress, "delist", int(listingId));
}

export async function buyListing(
    client: DAppClient,
    listingId: number,
    priceMutez: bigint,
    /** The marketplace holding it, from the listing. */
    marketplaceAddress: string,
): Promise<OpResult> {
    return send(client, marketplaceAddress, "buy", int(listingId), priceMutez, TRANSFER);
}

export async function makeOffer(
    client: DAppClient,
    generator: string,
    tokenId: string,
    amountMutez: bigint,
): Promise<OpResult> {
    const market = await marketplace();
    // `collection` is the entrypoint's own parameter name, so it is spelled out
    // rather than shorthanded: the key goes on chain.
    const p = await encode(market, "make_offer", { collection: generator, token_id: tokenId });
    return send(client, market, p.entrypoint, p.value, amountMutez, TRANSFER);
}

export async function cancelOffer(
    client: DAppClient,
    offerId: number,
    /** The marketplace holding the escrowed tez, from the offer. */
    marketplaceAddress: string,
): Promise<OpResult> {
    return send(client, marketplaceAddress, "cancel_offer", int(offerId));
}

export async function acceptOffer(
    client: DAppClient,
    offerId: number,
    /** The marketplace holding the offer, from the offer. */
    marketplaceAddress: string,
): Promise<OpResult> {
    return send(client, marketplaceAddress, "accept_offer", int(offerId), 0, TRANSFER);
}

/** Artist controls on their own generator. */
export function setPaused(
    client: DAppClient,
    generator: string,
    paused: boolean,
): Promise<OpResult> {
    return send(client, generator, "set_paused", { prim: paused ? "True" : "False" });
}

export function setPrice(
    client: DAppClient,
    generator: string,
    priceMutez: bigint,
): Promise<OpResult> {
    return send(client, generator, "set_price", int(priceMutez));
}

export function setEditionSize(
    client: DAppClient,
    generator: string,
    size: number,
): Promise<OpResult> {
    return send(client, generator, "set_edition_size", int(size));
}

/**
 * Switch who renders this generator's images.
 *
 * `maxPriceMutez` is the artist's ceiling. The contract reads the provider's
 * live price and fails if it exceeds this, so a provider that raises their
 * price between the quote on screen and the signature cannot silently charge
 * more.
 */
export async function setProvider(
    client: DAppClient,
    generator: string,
    provider: string,
    maxPriceMutez: bigint,
): Promise<OpResult> {
    const p = await encode(generator, "set_provider", {
        provider,
        max_price: maxPriceMutez.toString(),
    });
    return send(client, generator, p.entrypoint, p.value);
}

/** Let Aleatory's keys publish metadata for unrevealed pieces, or stop them. */
export function setTrustResolver(
    client: DAppClient,
    generator: string,
    trusted: boolean,
): Promise<OpResult> {
    return send(client, generator, "set_trust_resolver", {
        prim: trusted ? "True" : "False",
    });
}

export interface DeployParams {
    /** The generator itself, hex, no prefix. The art lives in contract storage. */
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
 * Originate a generator through the factory. The artist's one signature.
 *
 * Taquito encodes the parameter against the factory's own type, read from the
 * chain. A record's Michelson layout sorts its fields, and a map's keys go in
 * the protocol's order for their type, which for addresses is their binary form
 * and not their text. Both are invisible until an artist's signature is
 * rejected.
 *
 * The caller is written in as administrator in the generator's initial
 * storage, so nothing passes through us and the storage burn is charged to the
 * artist's own wallet.
 */
/**
 * What a generator currently holds, and whether it is closed.
 *
 * A chunked publish is several signatures, and a wallet closed between two of
 * them leaves a real contract holding part of its own art. Resuming asks the
 * chain what arrived rather than trusting anything the browser kept, so a
 * reload, another machine or another day all continue from the same place.
 *
 * The bytes come back, not just their length, because appending is blind: the
 * caller has to prove what is there is the beginning of what it is sending
 * before it adds to it.
 */
export async function readCode(generator: string): Promise<{ hex: string; sealed: boolean }> {
    const res = await indexerFetch(`${tzktApi()}/v1/contracts/${generator}/storage`, {
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`Could not read ${generator}.`);
    const s = (await res.json()) as { art?: { code?: string; code_sealed?: boolean } };
    // An unrelated contract has no `art` at all, and reading that as an empty
    // generator makes every unrelated contract look like one waiting for its
    // first chunk.
    if (!s.art || typeof s.art.code_sealed !== "boolean") {
        throw new Error(`${generator} is not an Aleatory generator.`);
    }
    return {
        hex: (s.art.code ?? "").replace(/^0x/, "").toLowerCase(),
        sealed: s.art.code_sealed === true,
    };
}

/**
 * The generator a deploy originated, once the chain has it.
 *
 * The deploy returns an operation hash and the address is decided by the
 * protocol, so the chunks that follow have nowhere to go until the origination
 * is visible.
 *
 * Read from the operation group itself. `/operations/originations` has no
 * `hash` filter: TzKT ignores query parameters it does not recognise, so
 * passing one returns the whole table, and taking the first row of that is how
 * chunks of somebody's generator were offered to an unrelated counter
 * contract.
 */
export async function generatorFromDeploy(hash: string, timeoutMs = 120_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await indexerFetch(`${tzktApi()}/v1/operations/${hash}`, {
            cache: "no-store",
        }).catch(() => null);
        if (res?.ok) {
            const rows = (await res.json()) as {
                type?: string;
                originatedContract?: { address?: string };
            }[];
            const address = rows.find((r) => r.type === "origination")?.originatedContract?.address;
            if (address) return address;
        }
        await new Promise((r) => setTimeout(r, 3_000));
    }
    // Most often this is an operation the bakers never took. A fee under the
    // floor is not an error anywhere: it injects, returns a hash, and is
    // dropped from the mempool, so the only symptom is an address that never
    // arrives. Saying "not indexed yet" sends people to look at the indexer.
    throw new Error(
        "The deploy was signed but no contract has appeared. It may not have been included in a block. Check the operation hash on the explorer; if it is not there, it was dropped and can be published again.",
    );
}

/**
 * That this address is a generator one of our factories made.
 *
 * Checked before anything is appended to it. `append_code` takes bytes and the
 * artist's signature, and the cost of sending those to the wrong contract is
 * not recoverable, so the address is confirmed against the router rather than
 * trusted because a lookup returned it.
 */
export async function isOurGenerator(generator: string): Promise<boolean> {
    // No `select`. TzKT ignores parameters it does not support rather than
    // refusing them, and `select=creator` here returns the whole record, whose
    // own `address` is the contract asked about. Reading that as the creator
    // compares a generator to the factory list and finds it foreign.
    const res = await indexerFetch(`${tzktApi()}/v1/contracts/${generator}`, {
        cache: "no-store",
    }).catch(() => null);
    if (!res?.ok) return false;
    const row = (await res.json()) as { creator?: { address?: string } };
    const creator = row.creator?.address ?? "";
    if (!creator) return false;
    return (await allFactories()).includes(creator);
}

/**
 * Add one chunk to the end of a generator's code. Artist only, and refused
 * once sealed.
 *
 * `at` is the length the caller believes is already written. The contract
 * refuses the write unless that is what it holds, which is what stops a chunk
 * being applied twice: a retry cannot know whether an operation still in
 * flight has landed, and `code` cannot be shortened afterwards.
 *
 * Generators from a factory originated before that entrypoint took an offset
 * are still out there, and some of them are unsealed. They are finished with
 * the signature they have. The parameter is encoded against the type read from
 * the contract itself rather than assumed, so which one it is comes from the
 * chain.
 *
 * The storage limit is the chunk: these bytes land in the contract's storage
 * and the artist pays the burn, the same way the inline path pays it inside
 * the deploy.
 */
export async function appendCode(
    client: DAppClient,
    generator: string,
    chunkHex: string,
    at: number,
): Promise<OpResult> {
    const hex = chunkHex.replace(/^0x/, "");
    const size = Math.ceil(hex.length / 2);
    const limits: Limits = { gas: 30_000, storage: size + 100, bytes: size + 500 };

    const p = await encode(generator, "append_code", { chunk: hex, at }).catch(() =>
        // A template from before the offset, which takes the bytes alone.
        encode(generator, "append_code", [hex]),
    );
    return send(client, generator, p.entrypoint, p.value, 0, limits);
}

/**
 * Close the generator. Nothing writes the code afterwards and minting is
 * refused until this lands.
 */
export async function sealCode(client: DAppClient, generator: string): Promise<OpResult> {
    return send(client, generator, "seal_code", { prim: "Unit" }, 0, SMALL);
}

export async function deployGenerator(client: DAppClient, params: DeployParams): Promise<OpResult> {
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
    // contract's storage, so the storage limit and the fee both scale with it.
    const codeBytes = Math.ceil(params.codeHex.replace(/^0x/, "").length / 2);
    const limits: Limits = {
        gas: 60_000,
        storage: codeBytes + ORIGINATION_OVERHEAD_BYTES,
        bytes: await packedBytes(parameter.value),
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
