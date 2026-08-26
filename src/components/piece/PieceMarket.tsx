"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { formatTez, shortAddress, parseTez, CONFIRM_ABOVE_MUTEZ } from "@/lib/utils";
import { proceeds, type Listing, type Offer } from "@/lib/market";
import { CONTRACTS } from "@/lib/config";
import * as ops from "@/lib/ops";

/**
 * Buying, listing and offers for one piece.
 *
 * Listing takes two operations: the collection has to make the marketplace an
 * operator before the marketplace can escrow the token. The UI says so up
 * front, so the second wallet prompt is expected.
 */
export function PieceMarket({
    contract,
    tokenId,
    owner,
    listing,
    offers,
    royaltyBps,
}: {
    contract: string;
    tokenId: string;
    owner?: string;
    listing: Listing | null;
    offers: Offer[];
    royaltyBps: number;
}) {
    const { address, connect, getClient } = useWallet();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [price, setPrice] = useState("");
    const [offer, setOffer] = useState("");

    // Parsed once. The preview and the operation read the same number, so
    // what a person is shown is what they sign for.
    const priceMutez = parseTez(price);
    const offerMutez = parseTez(offer);

    const isOwner = Boolean(address && owner && address === owner);
    const isSeller = Boolean(address && listing && address === listing.seller);

    if (!CONTRACTS.marketplace) {
        return (
            <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                The marketplace is waiting to be deployed.
            </p>
        );
    }

    async function run(label: string, fn: () => Promise<unknown>) {
        setBusy(label);
        setError(null);
        try {
            await fn();
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not go through");
        } finally {
            setBusy(null);
        }
    }

    const tez = (mutez: bigint) => `${formatTez(mutez)} ꜩ`;

    return (
        <div className="space-y-3 rounded-lg border border-border p-4">
            {listing ? (
                <>
                    <div className="flex items-baseline justify-between">
                        <span className="text-sm text-muted-foreground">Listed</span>
                        <span className="text-lg font-semibold">{tez(listing.priceMutez)}</span>
                    </div>

                    {isSeller ? (
                        <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                                run("delist", async () => ops.delist(await getClient(), listing.id))
                            }
                            className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
                        >
                            {busy === "delist" ? "Removing" : "Remove listing"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                                address
                                    ? run("buy", async () =>
                                          ops.buyListing(await getClient(), listing.id, listing.priceMutez),
                                      )
                                    : void connect()
                            }
                            className="w-full rounded-md bg-alea-600 px-3 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                        >
                            {address ? (busy === "buy" ? "Confirming" : `Buy for ${tez(listing.priceMutez)}`) : "Connect to buy"}
                        </button>
                    )}
                </>
            ) : isOwner ? (
                <>
                    <label className="block text-sm text-muted-foreground" htmlFor="list-price">
                        List this piece
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="list-price"
                            inputMode="decimal"
                            placeholder="Price in ꜩ"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <button
                            type="button"
                            disabled={busy !== null || priceMutez === null}
                            onClick={() =>
                                run("list", async () => {
                                    const mutez = priceMutez as bigint;
                                    const client = await getClient();
                                    // The marketplace escrows the token, which
                                    // it can only do as an operator.
                                    await ops.addOperator(
                                        client,
                                        contract,
                                        address as string,
                                        CONTRACTS.marketplace,
                                        tokenId,
                                    );
                                    await ops.listToken(client, contract, tokenId, mutez);
                                })
                            }
                            className="rounded-md bg-alea-600 px-3 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                        >
                            {busy === "list" ? "Listing" : "List"}
                        </button>
                    </div>
                    {price !== "" && priceMutez === null && (
                        <p className="text-xs text-destructive">
                            Enter an amount in tez.
                        </p>
                    )}
                    {priceMutez !== null && (
                        <PriceBreakdown mutez={priceMutez} royaltyBps={royaltyBps} />
                    )}
                    <p className="text-xs text-muted-foreground">
                        Two prompts: one to let the marketplace hold the piece, one to list it.
                    </p>
                </>
            ) : (
                <p className="text-sm text-muted-foreground">Not for sale</p>
            )}

            <div className="border-t border-border pt-3">
                <div className="flex gap-2">
                    <input
                        inputMode="decimal"
                        placeholder="Offer in ꜩ"
                        value={offer}
                        onChange={(e) => setOffer(e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                    <button
                        type="button"
                        disabled={busy !== null || offerMutez === null}
                        onClick={() =>
                            address
                                ? run("offer", async () => {
                                      const mutez = offerMutez as bigint;
                                      // An offer escrows real money the moment
                                      // it is signed, so a fat finger costs
                                      // more here than anywhere else on the
                                      // page.
                                      if (
                                          mutez >= CONFIRM_ABOVE_MUTEZ &&
                                          !window.confirm(
                                              `Offer ${formatTez(mutez)} tez? This escrows the amount until the offer is accepted or cancelled.`,
                                          )
                                      ) {
                                          return;
                                      }
                                      return ops.makeOffer(
                                          await getClient(),
                                          contract,
                                          tokenId,
                                          mutez,
                                      );
                                  })
                                : void connect()
                        }
                        className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
                    >
                        {busy === "offer" ? "Offering" : "Offer"}
                    </button>
                </div>

                {offers.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                        {offers.map((o) => (
                            <li key={o.id} className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{shortAddress(o.buyer)}</span>
                                <span className="flex items-center gap-2">
                                    <span className="font-medium">{tez(o.amountMutez)}</span>
                                    {isOwner && (
                                        <button
                                            type="button"
                                            disabled={busy !== null}
                                            onClick={() =>
                                                run(`accept-${o.id}`, async () => {
                                                    const client = await getClient();
                                                    await ops.addOperator(
                                                        client,
                                                        contract,
                                                        address as string,
                                                        CONTRACTS.marketplace,
                                                        tokenId,
                                                    );
                                                    await ops.acceptOffer(client, o.id);
                                                })
                                            }
                                            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                                        >
                                            Accept
                                        </button>
                                    )}
                                    {address === o.buyer && (
                                        <button
                                            type="button"
                                            disabled={busy !== null}
                                            onClick={() =>
                                                run(`cancel-${o.id}`, async () =>
                                                    ops.cancelOffer(await getClient(), o.id),
                                                )
                                            }
                                            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

/** Where the money goes, shown before the seller signs. */
function PriceBreakdown({ mutez, royaltyBps }: { mutez: bigint; royaltyBps: number }) {
    if (mutez <= 0n) return null;
    const split = proceeds(mutez, 250, royaltyBps);
    const row = (label: string, v: bigint) => (
        <div className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span>{formatTez(v)} ꜩ</span>
        </div>
    );
    return (
        <div className="space-y-0.5 rounded-md bg-muted/50 px-3 py-2 text-xs">
            {row("Platform 2.5%", split.fee)}
            {royaltyBps > 0 && row(`Royalties ${(royaltyBps / 100).toFixed(2)}%`, split.royalties)}
            <div className="flex justify-between border-t border-border pt-1 font-medium">
                <span>You receive</span>
                <span>{formatTez(split.seller)} ꜩ</span>
            </div>
        </div>
    );
}
