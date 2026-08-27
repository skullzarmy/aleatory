import Link from "next/link";
import type { Metadata } from "next";
import { fetchAllCollections } from "@/lib/collection";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { shortAddress, timeAgo } from "@/lib/utils";
import { LiveRefresh } from "@/components/LiveRefresh";

export const metadata: Metadata = { title: "Collections" };
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

            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {collections.map((c) => (
                    <li key={c.address}>
                        <Link
                            href={`/collection/${c.address}`}
                            className="group block overflow-hidden rounded-lg border border-border transition-colors hover:border-foreground/30"
                        >
                            <div className="aspect-square overflow-hidden bg-muted">
                                {c.coverUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={c.coverUrl}
                                        alt=""
                                        loading="lazy"
                                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                                    />
                                ) : (
                                    <span className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                                        {c.minted === 0
                                            ? "Nothing minted yet"
                                            : "First image on its way"}
                                    </span>
                                )}
                            </div>

                            <div className="p-3">
                                <p className="truncate text-sm font-medium">
                                    {c.name || shortAddress(c.address)}
                                </p>
                                <p className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                                    <span>{c.minted} minted</span>
                                    <span className="shrink-0">
                                        {c.firstActivity ? timeAgo(c.firstActivity) : ""}
                                    </span>
                                </p>
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
