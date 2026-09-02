"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { useOffers } from "@/context/OffersContext";
import { AccountLink } from "@/components/account/AccountLink";
import { piecesFor, type FeedPiece } from "@/lib/feed";
import { fetchRoyaltyBps } from "@/lib/collection";
import { proceeds, type IncomingOffer, type Offer } from "@/lib/market";
import { formatTez, shortAddress } from "@/lib/utils";
import * as ops from "@/lib/ops";

/**
 * Both sides of the offer book, for the connected wallet.
 *
 * An offer escrows real tez the moment it is signed, and until this page the
 * only place either side of one appeared was the piece it was made on. An owner
 * had to visit every piece they hold to find out somebody had offered, and a
 * buyer who offered and moved on had tez sitting in a marketplace contract with
 * nothing that listed it back to them.
 *
 * Nothing here is private. Every row is public chain state read through TzKT,
 * filtered to one address, which is why it needs no server and no account.
 */
const keyOf = (o: Offer) => `${o.marketplace}:${o.id}`;
const pairOf = (o: Offer) => `${o.collection}:${o.tokenId}`;

export default function OffersPage() {
    const { address, connecting, restoring, connect, getClient } = useWallet();
    const { incoming, outgoing, loading, refresh, markSeen } = useOffers();

    const [pieces, setPieces] = useState<Map<string, FeedPiece>>(new Map());
    const [royalties, setRoyalties] = useState<Map<string, number>>(new Map());
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // An operation has landed and the indexer has not caught up. Controls stay
    // disabled through this, or the page still shows an offer that has been
    // accepted and happily offers to accept it again.
    const [settling, setSettling] = useState(false);

    // Looked at, for as long as this page is open. Runs again whenever the set
    // changes, so an offer that arrives while it is on screen is not left
    // lighting the dot behind the reader's back. `markSeen` changes identity
    // with the set, which is what re-runs this.
    useEffect(() => {
        markSeen();
    }, [markSeen]);

    // Only changes when the set of pieces does. The poll returns fresh objects
    // every minute, and keying the reads below on the offers themselves would
    // re-fetch every image and every royalty on each of them.
    const pairsKey = useMemo(
        () =>
            [...new Set([...incoming, ...outgoing].map(pairOf))]
                .sort((a, b) => a.localeCompare(b))
                .join(","),
        [incoming, outgoing],
    );

    // The images and names. A listing carries a collection, a token id and a
    // price and nothing else, and so does an offer, so what somebody is being
    // asked to sell is a second read. One query for the whole page.
    useEffect(() => {
        const pairs = pairsKey
            .split(",")
            .filter(Boolean)
            .map((k) => {
                const [collection, tokenId] = k.split(":");
                return { collection, tokenId };
            });
        if (pairs.length === 0) {
            setPieces(new Map());
            return;
        }
        let cancelled = false;
        void piecesFor(pairs)
            .then((m) => {
                if (!cancelled) setPieces(m);
            })
            .catch(() => {
                /* a row without its picture is still a row with the money on it */
            });
        return () => {
            cancelled = true;
        };
    }, [pairsKey]);

    // What each collection takes, so a row can say what accepting actually
    // pays. One small read per collection: `fetchRoyaltyBps` asks for the one
    // field rather than the whole storage record, which carries the generator.
    const collectionsKey = useMemo(
        () =>
            [...new Set(incoming.map((o) => o.collection))]
                .sort((a, b) => a.localeCompare(b))
                .join(","),
        [incoming],
    );
    useEffect(() => {
        const list = collectionsKey.split(",").filter(Boolean);
        if (list.length === 0) return;
        let cancelled = false;
        void Promise.all(
            list.map(async (c) => [c, await fetchRoyaltyBps(c).catch(() => 0)] as const),
        ).then((entries) => {
            if (!cancelled) setRoyalties(new Map(entries));
        });
        return () => {
            cancelled = true;
        };
    }, [collectionsKey]);

    // Refresh until the answer changes, then stop. Capped, because a page that
    // polls forever after a stalled indexer is worse than one that gives up and
    // lets the reader reload. Same shape as PieceMarket, for the same reason: a
    // signature returns when the operation is injected, seconds before it is in
    // a block and longer before an indexer has it.
    const stamp = `${incoming.map(keyOf).join(",")}|${outgoing.map(keyOf).join(",")}`;
    const settled = useRef<string>("");
    useEffect(() => {
        if (!settling) {
            settled.current = stamp;
            return;
        }
        if (stamp !== settled.current) {
            settled.current = stamp;
            setSettling(false);
            return;
        }
        let tries = 0;
        const id = window.setInterval(() => {
            if (++tries > 12) {
                window.clearInterval(id);
                setSettling(false);
                return;
            }
            refresh();
        }, 4000);
        return () => window.clearInterval(id);
    }, [settling, stamp, refresh]);

    async function run(label: string, fn: () => Promise<unknown>) {
        setBusy(label);
        setError(null);
        try {
            await fn();
            setSettling(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not go through");
        } finally {
            setBusy(null);
        }
    }

    const disabled = busy !== null || settling;

    if (restoring) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">Restoring your session…</p>
            </Shell>
        );
    }

    if (!address) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">
                    Connect a wallet to see offers on the pieces it holds, and the offers it has
                    made.
                </p>
                <button
                    type="button"
                    onClick={() => void connect()}
                    disabled={connecting}
                    className="mt-4 rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {connecting ? "Connecting" : "Connect"}
                </button>
            </Shell>
        );
    }

    if (loading) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">Loading…</p>
            </Shell>
        );
    }

    if (incoming.length === 0 && outgoing.length === 0) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">
                    Nothing standing against {shortAddress(address)}, either way.
                </p>
                <Link
                    href="/market"
                    className="mt-4 inline-block rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    Browse the market
                </Link>
            </Shell>
        );
    }

    return (
        <Shell>
            {incoming.length > 0 && (
                <Section title="On your pieces" count={incoming.length}>
                    {incoming.map((o) => (
                        <IncomingRow
                            key={keyOf(o)}
                            offer={o}
                            piece={pieces.get(pairOf(o))}
                            royaltyBps={royalties.get(o.collection) ?? 0}
                            busy={busy === `accept-${keyOf(o)}`}
                            disabled={disabled}
                            onAccept={() =>
                                run(`accept-${keyOf(o)}`, async () =>
                                    ops.acceptOfferFor(
                                        await getClient(),
                                        o.collection,
                                        address,
                                        o.tokenId,
                                        o.id,
                                        o.marketplace,
                                    ),
                                )
                            }
                        />
                    ))}
                </Section>
            )}

            {outgoing.length > 0 && (
                <Section title="Yours" count={outgoing.length}>
                    {outgoing.map((o) => (
                        <OutgoingRow
                            key={keyOf(o)}
                            offer={o}
                            piece={pieces.get(pairOf(o))}
                            busy={busy === `cancel-${keyOf(o)}`}
                            disabled={disabled}
                            onCancel={() =>
                                run(`cancel-${keyOf(o)}`, async () =>
                                    ops.cancelOffer(await getClient(), o.id, o.marketplace),
                                )
                            }
                        />
                    ))}
                </Section>
            )}

            {settling && (
                <p className="mt-4 text-xs text-muted-foreground" role="status" aria-live="polite">
                    Waiting for the chain to confirm…
                </p>
            )}
            {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
        </Shell>
    );
}

function IncomingRow({
    offer,
    piece,
    royaltyBps,
    busy,
    disabled,
    onAccept,
}: {
    offer: IncomingOffer;
    piece?: FeedPiece;
    royaltyBps: number;
    busy: boolean;
    disabled: boolean;
    onAccept: () => void;
}) {
    // The fee on the offer itself, not the marketplace's current one. `set_fee`
    // is never retroactive, so this is what accepting actually pays.
    const split = proceeds(offer.amountMutez, offer.feeBps, royaltyBps);

    return (
        <Row offer={offer} piece={piece}>
            <p className="text-xs text-muted-foreground">
                from <AccountLink address={offer.buyer} />
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 sm:justify-start">
                <span className="text-xs text-muted-foreground">
                    You receive {formatTez(split.seller)} ꜩ
                </span>
                {/* `accept_offer` transfers the token from the sender, and
                    listing escrows it into the marketplace, so a listed piece
                    cannot be accepted against until it is delisted. Saying so
                    beats a button the wallet would reject. */}
                {offer.listed ? (
                    <Link
                        href={`/piece/${offer.collection}/${offer.tokenId}`}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                        Listed, remove it to accept
                    </Link>
                ) : (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={onAccept}
                        className="rounded-md bg-alea-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                    >
                        {busy ? "Accepting" : "Accept"}
                    </button>
                )}
            </div>
        </Row>
    );
}

function OutgoingRow({
    offer,
    piece,
    busy,
    disabled,
    onCancel,
}: {
    offer: Offer;
    piece?: FeedPiece;
    busy: boolean;
    disabled: boolean;
    onCancel: () => void;
}) {
    return (
        <Row offer={offer} piece={piece}>
            <p className="text-xs text-muted-foreground">Escrowed until accepted or cancelled</p>
            <div className="mt-2 flex justify-end sm:justify-start">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onCancel}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
                >
                    {busy ? "Cancelling" : "Cancel, take the tez back"}
                </button>
            </div>
        </Row>
    );
}

/** The piece, the amount, and room for whatever the row's side needs. */
function Row({
    offer,
    piece,
    children,
}: {
    offer: Offer;
    piece?: FeedPiece;
    children: React.ReactNode;
}) {
    const href = `/piece/${offer.collection}/${offer.tokenId}`;

    return (
        <li className="flex gap-3 p-3 sm:gap-4 sm:p-4">
            <Link href={href} className="shrink-0">
                {/* The plate matters: an image that fails to load collapses to
                    it instead of painting the browser's broken glyph into the
                    row. `alt=""` is what makes it collapse, and the name beside
                    it already names the link. */}
                <span className="block h-14 w-14 overflow-hidden rounded-md bg-muted sm:h-16 sm:w-16">
                    {piece?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={piece.imageUrl}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <span className="pending-shimmer block h-full w-full" />
                    )}
                </span>
            </Link>

            <div className="flex min-w-0 flex-1 flex-col gap-x-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <Link
                        href={href}
                        className="block truncate text-sm font-medium hover:underline"
                    >
                        {piece?.name || `#${Number(offer.tokenId) + 1}`}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                        {piece?.collectionName || shortAddress(offer.collection)}
                    </p>
                </div>

                <div className="mt-2 shrink-0 text-right sm:mt-0">
                    <p className="text-base font-semibold tabular-nums">
                        {formatTez(offer.amountMutez)} ꜩ
                    </p>
                    {children}
                </div>
            </div>
        </li>
    );
}

function Section({
    title,
    count,
    children,
}: {
    title: string;
    count: number;
    children: React.ReactNode;
}) {
    return (
        <section className="mb-8 last:mb-0">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                {title}
                <span className="rounded-full bg-muted px-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                    {count}
                </span>
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border">{children}</ul>
        </section>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Offers</h1>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">
                What has been offered on the pieces you hold, and what you have offered on somebody
                else&apos;s. Every offer here is holding tez in the marketplace until it is accepted
                or cancelled.
            </p>
            {children}
        </div>
    );
}
