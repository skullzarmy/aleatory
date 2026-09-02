import type { Metadata } from "next";
import { fetchAllCollections } from "@/lib/collection";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { LiveRefresh } from "@/components/LiveRefresh";
import { CollectionGrid } from "@/components/collection/CollectionCard";

export const metadata: Metadata = {
    title: "Collections",
    alternates: { canonical: "/collections" },
    openGraph: {
        type: "website",
        title: "Collections",
        description: "Every collection on Aleatory, fully on-chain generative art on Tezos.",
    },
};
export const revalidate = 60;

/**
 * Every collection, as a wall of work.
 *
 * A list of names was a list of KT1 addresses, because the name it showed was
 * TzKT's `alias`, which TzKT sets for contracts it happens to know and never
 * for ours. The name is now the artist's own, from the collection's metadata,
 * and the cover is its newest rendered piece: on a site about images, a text
 * list is a page that refuses to show you anything.
 */
export default async function CollectionsPage() {
    const collections = await fetchAllCollections();

    if (collections.length === 0) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-8">
                <LiveRefresh seconds={60} />
                <EmptyFeed reason="unconfigured" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <LiveRefresh seconds={60} />
            <h1 className="mb-6 text-xl font-semibold tracking-tight">Collections</h1>

            <CollectionGrid collections={collections} />
        </div>
    );
}
