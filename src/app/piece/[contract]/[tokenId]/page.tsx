import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPiece } from "@/lib/piece";
import { ArtifactFrame } from "@/components/piece/ArtifactFrame";
import { PieceFacts } from "@/components/piece/PieceFacts";
import { PieceMarket } from "@/components/piece/PieceMarket";
import { fetchListingFor, fetchOffersFor } from "@/lib/market";
import { ShareButtons } from "@/components/ShareButtons";
import { BRAND } from "@/lib/config";
import { resolveName } from "@/lib/identity";
import { shortAddress } from "@/lib/utils";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PieceJsonLd } from "@/components/JsonLd";

export const revalidate = 30;

type Params = Promise<{ contract: string; tokenId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { contract, tokenId } = await params;
    const piece = await fetchPiece(contract, tokenId).catch(() => null);
    if (!piece) return { title: "Piece" };

    // The artist by name where they have one. A title is read by a person, and
    // a tz1 tells them nothing about who made this.
    const artist = piece.artist
        ? ((await resolveName(piece.artist).catch(() => null)) ?? shortAddress(piece.artist))
        : null;

    // The root template appends " · Aleatory", so this is the whole title:
    //   Drift #4 by skllzrmy.tez · Aleatory
    const byline = artist ? `${piece.name} by ${artist}` : piece.name;
    const title = `${byline} · ${BRAND.name}`;
    const description = piece.description || BRAND.description;
    const images = piece.imageUrl ? [{ url: piece.imageUrl }] : undefined;

    return {
        title: byline,
        description,
        alternates: { canonical: `/piece/${contract}/${tokenId}` },
        openGraph: { type: "article", siteName: BRAND.name, title, description, images },
        // Without this X falls back to the small card, which crops a square
        // image to a thumbnail and wastes the only thing worth showing.
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
    if (!piece) return notFound();

    const [listing, offers] = await Promise.all([
        fetchListingFor(contract, tokenId).catch(() => null),
        fetchOffersFor(contract, tokenId).catch(() => []),
    ]);
    const royaltyTotal = piece.royalties.reduce((n, r) => n + r.bps, 0);

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <LiveRefresh seconds={30} />
            <PieceJsonLd
                name={piece.name}
                description={piece.description}
                imageUrl={piece.imageUrl}
                creator={piece.artist}
                mintedAt={piece.mintedAt}
                collectionName={piece.collectionName}
                url={`${BRAND.url}/piece/${contract}/${tokenId}`}
            />
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <ArtifactFrame
                    code={piece.code}
                    seed={piece.seed}
                    imageUrl={piece.imageUrl}
                    name={piece.name}
                />

                <div>
                    <h1 className="text-xl font-semibold tracking-tight">{piece.name}</h1>
                    {piece.description && (
                        <p className="mt-2 text-sm text-muted-foreground">{piece.description}</p>
                    )}

                    {piece.pending && (
                        <p className="mt-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            The image is still being made. You own this piece and can trade it
                            now, and it is running live above.
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
                            text={`${piece.name}${piece.collectionName ? `, from ${piece.collectionName}` : ""}`}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
