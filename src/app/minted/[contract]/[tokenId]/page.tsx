"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { IsolateFrame } from "@/components/IsolateFrame";
import { TimeAgo } from "@/components/TimeAgo";
import { tzktLink } from "@/lib/config";
import { fetchPiece, type Piece } from "@/lib/piece";
import { fetchCollection, type Collection } from "@/lib/collection";
import { shortAddress } from "@/lib/utils";
import { formatParamValue, specsOf, resolveParams } from "@/lib/params";
import { useWallet } from "@/context/WalletContext";
import { ShareButtons } from "@/components/ShareButtons";
import { BRAND } from "@/lib/config";
import { AccountLink } from "@/components/account/AccountLink";

/**
 * The moment after a mint.
 *
 * A collector has just signed for something nobody has ever seen, and the page
 * they landed on used to hand them an operation hash and stop. This is the
 * piece: running, live, from the generator in the collection's own storage and
 * the seed their signature just fixed.
 *
 * It runs here before any image exists because it can. The artwork is the code
 * and the seed, both on chain from the moment the operation lands, and the
 * image a provider publishes is a picture of it. Saying "awaiting render" over
 * an empty box would describe the picture and hide the piece.
 *
 * A client page on purpose: right after a mint, an indexer has usually not
 * caught up, so a server render would answer "no such token" for a token that
 * demonstrably exists. This reads the collection directly and polls for the
 * rest.
 */
export default function MintedPage({
    params,
}: {
    params: Promise<{ contract: string; tokenId: string }>;
}) {
    const { contract, tokenId } = use(params);
    const { address } = useWallet();
    const [collection, setCollection] = useState<Collection | null>(null);
    const [piece, setPiece] = useState<Piece | null>(null);
    const [waited, setWaited] = useState(0);
    // The published image is an upgrade over a piece already on screen, so it
    // is loaded out of band and only swapped in once it has actually arrived.
    // A gateway that is slow or gone leaves the live render where it is.
    const [imageOk, setImageOk] = useState(false);

    useEffect(() => {
        setImageOk(false);
        const url = piece?.imageUrl;
        if (!url) return;
        const img = new Image();
        img.onload = () => setImageOk(true);
        img.src = url;
    }, [piece?.imageUrl]);

    // The collection has everything needed to draw: the generator, and the
    // royalties and name the piece will inherit.
    useEffect(() => {
        void fetchCollection(contract).then(setCollection).catch(() => {});
    }, [contract]);

    // The piece itself arrives when the indexer catches up, and its image when
    // a provider publishes one. Polling stops once the image is there.
    useEffect(() => {
        let stop = false;
        const id = window.setInterval(async () => {
            if (stop) return;
            setWaited((w) => w + 1);
            const p = await fetchPiece(contract, tokenId).catch(() => null);
            if (stop) return;
            if (p) setPiece(p);
            if (p?.imageUrl) {
                stop = true;
                window.clearInterval(id);
            }
        }, 5000);
        return () => {
            stop = true;
            window.clearInterval(id);
        };
    }, [contract, tokenId]);

    const seed = piece?.seed ?? "";
    const values = collection?.paramsSchema
        ? resolveParams(specsOf(collection.paramsSchema), piece?.params ?? {})
        : {};

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <header className="mb-6">
                <p className="text-sm font-medium text-alea-600">It&apos;s yours</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                    {collection?.name || shortAddress(contract)} #{Number(tokenId) + 1}
                </h1>
                <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                    Nobody has seen this before. It is running below, drawn from the
                    generator stored in the contract and the seed your signature just fixed.
                </p>
            </header>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div>
                    <div className="aspect-square overflow-hidden rounded-lg border border-border">
                        {piece?.imageUrl && imageOk ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={piece.imageUrl}
                                alt=""
                                className="h-full w-full object-contain"
                            />
                        ) : collection?.code && seed ? (
                            <IsolateFrame
                                code={collection.code}
                                seed={seed}
                                params={values}
                                paramsSchema={specsOf(collection.paramsSchema)}
                                title="Your piece"
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                Finding your piece on chain…
                            </div>
                        )}
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                        {piece?.imageUrl
                            ? "The final image is published and stored on chain."
                            : seed
                              ? "Live from your browser. A render provider is making the permanent image now, which usually takes under a minute."
                              : "Waiting for the network to confirm."}
                    </p>
                </div>

                <div className="space-y-4">
                    <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                        <Row label="Owner">
                            {piece?.owner && piece.owner !== address ? (
                                <AccountLink address={piece.owner} />
                            ) : (
                                "You"
                            )}
                        </Row>
                        {piece?.mintedAt && (
                            <Row label="Minted">
                                <TimeAgo iso={piece.mintedAt} />
                            </Row>
                        )}
                        {seed && (
                            <Row label="Seed">
                                <a
                                    href={tzktLink(seed)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-mono text-xs hover:underline"
                                    title={seed}
                                >
                                    {shortAddress(seed, 8, 6)}
                                </a>
                            </Row>
                        )}
                        {collection?.royaltyTotalBps ? (
                            <Row label="Royalty">
                                {(collection.royaltyTotalBps / 100).toFixed(2)}% to the artist
                            </Row>
                        ) : null}
                        <Row label="Image">
                            {piece?.imageUrl ? "published" : `being made${dots(waited)}`}
                        </Row>
                    </dl>

                    {collection?.paramsSchema &&
                        specsOf(collection.paramsSchema).length > 0 && (
                            <div className="rounded-lg border border-border p-4">
                                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                                    What you chose
                                </p>
                                <dl className="space-y-1 text-sm">
                                    {specsOf(collection.paramsSchema).map((spec) => (
                                        <div key={spec.id} className="flex justify-between gap-3">
                                            <dt className="text-muted-foreground">{spec.label}</dt>
                                            <dd className="font-medium">
                                                {formatParamValue(spec, values[spec.id])}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}

                    <div className="grid gap-2">
                        {collection && !collection.soldOut && !collection.paused && (
                            <Link
                                href={`/collection/${contract}`}
                                className="rounded-md bg-alea-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-alea-700"
                            >
                                Mint another
                                {collection.editionSize > 0 && (
                                    <span className="ml-1 font-normal opacity-80">
                                        ({collection.editionSize - collection.minted} left)
                                    </span>
                                )}
                            </Link>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <Link
                                href="/mine"
                                className="rounded-md border border-border px-3 py-2 text-center text-sm hover:bg-accent"
                            >
                                What you own
                            </Link>
                            <Link
                                href="/collections"
                                className="rounded-md border border-border px-3 py-2 text-center text-sm hover:bg-accent"
                            >
                                Other collections
                            </Link>
                        </div>
                        <Link
                            href={`/piece/${contract}/${tokenId}`}
                            className="rounded-md px-3 py-1.5 text-center text-xs text-muted-foreground underline hover:text-foreground"
                        >
                            The piece&apos;s permanent page
                        </Link>
                    </div>

                    <div className="rounded-lg border border-border p-4">
                        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                            Show it off
                        </p>
                        <ShareButtons
                            url={`${BRAND.url}/piece/${contract}/${tokenId}`}
                            text={`I minted ${collection?.name || "a piece"} #${Number(tokenId) + 1} on ${BRAND.name}`}
                        />
                    </div>

                    <p className="text-xs text-muted-foreground">
                        You own it now, and can sell or transfer it whether or not the image
                        has landed. The piece is the code and the seed; the image is a
                        picture of it.
                    </p>
                </div>
            </div>
        </div>
    );
}

/** So "being made" reads as something happening rather than something stuck. */
function dots(n: number): string {
    return ".".repeat(n % 4);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
        </div>
    );
}
