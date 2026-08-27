import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchCollection, fetchCollectionPieces } from "@/lib/collection";
import { MintView } from "@/components/collection/MintView";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { shortAddress } from "@/lib/utils";
import { BRAND } from "@/lib/config";
import { coversFor } from "@/lib/feed";
import { AccountLink } from "@/components/account/AccountLink";
import { LiveRefresh } from "@/components/LiveRefresh";
import { CollectionJsonLd } from "@/components/JsonLd";

export const revalidate = 30;

type Params = Promise<{ address: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { address } = await params;
    const [c, covers] = await Promise.all([
        fetchCollection(address).catch(() => null),
        coversFor([address]).catch(() => new Map<string, string>()),
    ]);
    const name = c?.name || shortAddress(address);
    // The collection's newest rendered piece, which is what it looks like.
    const cover = covers.get(address);
    return {
        title: name,
        description: c?.description,
        alternates: { canonical: `/collection/${address}` },
        openGraph: {
            type: "website",
            title: name,
            description: c?.description,
            url: `${BRAND.url}/collection/${address}`,
            images: cover ? [{ url: cover }] : undefined,
        },
        twitter: {
            card: cover ? "summary_large_image" : "summary",
            title: name,
            description: c?.description,
            images: cover ? [cover] : undefined,
        },
    };
}

export default async function CollectionPage({ params }: { params: Params }) {
    const { address } = await params;
    const [collection, pieces] = await Promise.all([
        fetchCollection(address),
        fetchCollectionPieces(address),
    ]);
    if (!collection) return notFound();

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <LiveRefresh seconds={30} />
            <CollectionJsonLd
                name={collection.name || shortAddress(collection.address)}
                description={collection.description}
                creator={collection.artist}
                size={collection.editionSize || undefined}
                url={`${BRAND.url}/collection/${address}`}
            />
            <header className="mb-6">
                <h1 className="text-xl font-semibold tracking-tight">
                    {shortAddress(collection.address)}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    by{" "}
                    <AccountLink address={collection.artist} withAvatar />
                </p>
            </header>

            <MintView collection={collection} schema={collection.paramsSchema} />

            {collection.royalties.length > 0 && (
                <div className="mt-6 max-w-sm rounded-lg border border-border p-4">
                    <p className="pb-2 text-sm text-muted-foreground">Royalties</p>
                    {collection.royalties.map((r) => (
                        <div key={r.address} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                                <AccountLink address={r.address} />
                            </span>
                            <span className="font-medium">{(r.bps / 100).toFixed(2)}%</span>
                        </div>
                    ))}
                </div>
            )}

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
