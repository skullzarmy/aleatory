import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchCollection, fetchCollectionPieces } from "@/lib/collection";
import { MintPanel } from "@/components/collection/MintPanel";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { ArtifactFrame } from "@/components/piece/ArtifactFrame";
import { renderUrl } from "@/lib/piece";
import { shortAddress } from "@/lib/utils";
import { tzktLink } from "@/lib/config";

export const revalidate = 30;

type Params = Promise<{ address: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { address } = await params;
    const c = await fetchCollection(address).catch(() => null);
    return { title: c ? `Collection ${shortAddress(address)}` : "Collection" };
}

export default async function CollectionPage({ params }: { params: Params }) {
    const { address } = await params;
    const [collection, pieces] = await Promise.all([
        fetchCollection(address),
        fetchCollectionPieces(address),
    ]);
    if (!collection) notFound();

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div>
                    {/* A generator with no seed shows what the space looks
                        like before anyone has drawn from it. */}
                    <ArtifactFrame
                        renderUrl={collection.codeUri ? renderUrl(collection.codeUri) : undefined}
                        name="Generator preview"
                    />
                </div>

                <div className="space-y-4">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight">
                            {shortAddress(collection.address)}
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            by{" "}
                            <a
                                href={tzktLink(collection.artist)}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline"
                            >
                                {shortAddress(collection.artist)}
                            </a>
                        </p>
                    </div>

                    <MintPanel collection={collection} />

                    {collection.royalties.length > 0 && (
                        <div className="rounded-lg border border-border p-4">
                            <p className="pb-2 text-sm text-muted-foreground">Royalties</p>
                            {collection.royalties.map((r) => (
                                <div key={r.address} className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        {shortAddress(r.address)}
                                    </span>
                                    <span className="font-medium">{(r.bps / 100).toFixed(2)}%</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {pieces.length > 0 && (
                <div className="mt-12">
                    <h2 className="mb-4 text-lg font-semibold tracking-tight">
                        Pieces ({collection.minted})
                    </h2>
                    <FeedGrid pieces={pieces} />
                </div>
            )}
        </div>
    );
}
