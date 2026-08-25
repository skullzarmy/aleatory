/**
 * Every write this app makes, in one file.
 *
 * Each function builds a single operation and hands it to the wallet. Reading
 * this file tells you the complete set of things the site can ask a visitor
 * to sign.
 */
import type { DAppClient, TezosOperationType } from "@tezos-x/octez.connect-sdk";
import { CONTRACTS } from "./config";

interface OpResult {
    hash: string;
}

async function send(
    client: DAppClient,
    destination: string,
    entrypoint: string,
    value: unknown,
    amountMutez = 0,
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
const int = (v: number | string) => ({ int: String(v) });
const bytes = (hex: string) => ({ bytes: hex.replace(/^0x/, "") });

export function utf8ToHex(s: string): string {
    return Array.from(new TextEncoder().encode(s))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Buy one edition. The collector's single signature.
 *
 * The amount covers the price and the render gas together, and this
 * operation's hash becomes the piece's seed.
 */
export function buy(
    client: DAppClient,
    collection: string,
    params: string,
    totalMutez: number,
): Promise<OpResult> {
    return send(client, collection, "buy", bytes(utf8ToHex(params)), totalMutez);
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

export function listToken(
    client: DAppClient,
    collection: string,
    tokenId: string,
    priceMutez: number,
): Promise<OpResult> {
    return send(client, CONTRACTS.marketplace, "list_token", {
        prim: "Pair",
        args: [str(collection), { prim: "Pair", args: [int(tokenId), int(priceMutez)] }],
    });
}

export function delist(client: DAppClient, listingId: number): Promise<OpResult> {
    return send(client, CONTRACTS.marketplace, "delist", int(listingId));
}

export function buyListing(
    client: DAppClient,
    listingId: number,
    priceMutez: number,
): Promise<OpResult> {
    return send(client, CONTRACTS.marketplace, "buy", int(listingId), priceMutez);
}

export function makeOffer(
    client: DAppClient,
    collection: string,
    tokenId: string,
    amountMutez: number,
): Promise<OpResult> {
    return send(
        client,
        CONTRACTS.marketplace,
        "make_offer",
        { prim: "Pair", args: [str(collection), int(tokenId)] },
        amountMutez,
    );
}

export function cancelOffer(client: DAppClient, offerId: number): Promise<OpResult> {
    return send(client, CONTRACTS.marketplace, "cancel_offer", int(offerId));
}

export function acceptOffer(client: DAppClient, offerId: number): Promise<OpResult> {
    return send(client, CONTRACTS.marketplace, "accept_offer", int(offerId));
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
    priceMutez: number,
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
