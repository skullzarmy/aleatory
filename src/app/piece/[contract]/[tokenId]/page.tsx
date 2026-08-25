import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPiece } from "@/lib/piece";
import { ArtifactFrame } from "@/components/piece/ArtifactFrame";
import { PieceFacts } from "@/components/piece/PieceFacts";
import { BRAND } from "@/lib/config";

export const revalidate = 30;

type Params = Promise<{ contract: string; tokenId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { contract, tokenId } = await params;
    const piece = await fetchPiece(contract, tokenId).catch(() => null);
    if (!piece) return { title: "Piece" };

    return {
        title: piece.name,
        description: piece.description || BRAND.description,
        openGraph: {
            title: `${piece.name} · ${piece.collectionName ?? BRAND.name}`,
            description: piece.description || BRAND.description,
            images: piece.imageUrl ? [{ url: piece.imageUrl }] : undefined,
        },
    };
}

export default async function PiecePage({ params }: { params: Params }) {
    const { contract, tokenId } = await params;
    const piece = await fetchPiece(contract, tokenId);
    if (!piece) notFound();

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <ArtifactFrame
                    renderUrl={piece.renderUrl}
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
                            This piece is awaiting its render. It is owned and tradeable now, and
                            the artwork runs from chain state above.
                        </p>
                    )}

                    <div className="mt-4">
                        <PieceFacts piece={piece} />
                    </div>
                </div>
            </div>
        </div>
    );
}
