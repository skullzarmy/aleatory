import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPiece } from "@/lib/piece";
import { Suspense } from "react";
import { ArtifactFrame } from "@/components/piece/ArtifactFrame";
import { PieceArriving } from "@/components/piece/PieceArriving";
import { JustMinted } from "@/components/piece/JustMinted";
import { fetchGenerator } from "@/lib/generator";
import { PieceFacts } from "@/components/piece/PieceFacts";
import { PieceMarket } from "@/components/piece/PieceMarket";
import { fetchListingFor, fetchOffersFor } from "@/lib/market";
import { ShareButtons } from "@/components/ShareButtons";
import { BRAND } from "@/lib/config";
import { resolveName } from "@/lib/identity";
import { shortAddress } from "@/lib/utils";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PieceJsonLd } from "@/components/JsonLd";

/**
 * Rendered per request. `revalidate` here made this a prerendered document, and
 * the refresh below re-fetched that same document rather than the chain.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ contract: string; tokenId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { contract, tokenId } = await params;
    const piece = await fetchPiece(contract, tokenId).catch(() => null);
    if (!piece) return { title: "Piece" };

    const artist = piece.artist
        ? ((await resolveName(piece.artist).catch(() => null)) ?? shortAddress(piece.artist))
        : null;

    // The root template appends " · Aleatory".
    const byline = artist ? `${piece.name} by ${artist}` : piece.name;
    const title = `${byline} · ${BRAND.name}`;
    const description = piece.description || BRAND.description;
    const images = piece.imageUrl ? [{ url: piece.imageUrl }] : undefined;

    return {
        title: byline,
        description,
        alternates: { canonical: `/piece/${contract}/${tokenId}` },
        openGraph: { type: "article", siteName: BRAND.name, title, description, images },
        // Without this X falls back to the small card, cropping a square image to a thumbnail.
        twitter: {
            card: piece.imageUrl ? "summary_large_image" : "summary",
            title,
            description,
            images: piece.imageUrl ? [piece.imageUrl] : undefined,
        },
    };
}

export default async function PiecePage({ params }: { params: Params }) {
    const { contract, tokenId } = await params;
    const piece = await fetchPiece(contract, tokenId);

    // The indexer may not have caught up yet; check the contract's next_token_id
    // (the count it has issued) before treating a token as not existing.
    if (!piece?.seed) {
        const generator = await fetchGenerator(contract).catch(() => null);
        const minted = generator ? Number(tokenId) < generator.minted : false;
        if (!minted) return notFound();
        return <PieceArriving contract={contract} tokenId={tokenId} />;
    }

    const [listing, offers] = await Promise.all([
        fetchListingFor(contract, tokenId).catch(() => null),
        fetchOffersFor(contract, tokenId).catch(() => []),
    ]);
    const royaltyTotal = piece.royalties.reduce((n, r) => n + r.bps, 0);

    // Null for an open edition, which has nothing to count down.
    const remaining = piece.editionSize > 0 ? Math.max(0, piece.editionSize - piece.minted) : null;

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <LiveRefresh seconds={30} />
            <PieceJsonLd
                name={piece.name}
                description={piece.description}
                imageUrl={piece.imageUrl}
                creator={piece.artist}
                mintedAt={piece.mintedAt}
                generatorName={piece.generatorName}
                url={`${BRAND.url}/piece/${contract}/${tokenId}`}
            />
            {/* Only for whoever arrived here from the mint; a shared link gets the plain page. */}
            <Suspense fallback={null}>
                <JustMinted contract={contract} remaining={remaining} />
            </Suspense>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="min-w-0">
                    {/* Params must be passed, or the frame renders the generator's fallbacks
                        instead of the piece on the token. */}
                    <ArtifactFrame
                        code={piece.code}
                        seed={piece.seed}
                        params={pieceParams(piece.params)}
                        imageUrl={piece.imageUrl}
                        name={piece.name}
                    />
                </div>

                <div className="min-w-0">
                    <h1 className="break-words text-xl font-semibold tracking-tight">
                        {piece.name}
                    </h1>
                    {piece.description && (
                        <p className="mt-2 break-words text-sm text-muted-foreground">
                            {piece.description}
                        </p>
                    )}

                    {piece.pending && (
                        <p className="mt-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            The image is still being made. You own this piece and can trade it now,
                            and it is running live above.
                        </p>
                    )}

                    <div className="mt-4">
                        <PieceMarket
                            contract={contract}
                            tokenId={tokenId}
                            owner={piece.owner}
                            listing={listing}
                            offers={offers}
                            royaltyBps={royaltyTotal}
                        />
                    </div>

                    <div className="mt-4">
                        <PieceFacts piece={piece} />
                    </div>

                    <div className="mt-4">
                        <ShareButtons
                            url={`${BRAND.url}/piece/${contract}/${tokenId}`}
                            text={`${piece.name}${piece.generatorName ? `, from ${piece.generatorName}` : ""}`}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

// Parsed and handed over as written, with no schema resolution, matching what the
// render provider did when it made the pinned image. Any divergence here would make
// the live render disagree with the permanent one.
function pieceParams(json?: string): Record<string, unknown> | undefined {
    if (!json) return undefined;
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}
