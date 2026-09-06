import Link from "next/link";
import { shortAddress, timeAgoShort } from "@/lib/utils";
import type { CollectionSummary } from "@/lib/collection";

export function CollectionCard({ collection: c }: { collection: CollectionSummary }) {
    const soldOut = c.editionSize > 0 && c.minted >= c.editionSize;

    return (
        <Link
            href={`/collection/${c.address}`}
            className="group block overflow-hidden rounded-lg border border-border transition-colors hover:border-foreground/30"
        >
            <div className="relative aspect-square overflow-hidden bg-muted">
                {soldOut && (
                    <span className="absolute right-2 top-2 z-10 rounded-md bg-background/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide backdrop-blur">
                        Sold out
                    </span>
                )}
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
                        {c.minted === 0 ? "Nothing minted yet" : "First image on its way"}
                    </span>
                )}
            </div>

            <div className="p-3">
                <p className="truncate text-sm font-medium">{c.name || shortAddress(c.address)}</p>
                <p className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                        {c.editionSize === 0
                            ? `${c.minted} minted, open edition`
                            : soldOut
                              ? `${c.editionSize} minted`
                              : `${c.editionSize - c.minted} of ${c.editionSize} remaining`}
                    </span>
                    <span className="shrink-0">
                        {c.firstActivity ? `created ${timeAgoShort(c.firstActivity)}` : ""}
                    </span>
                </p>
            </div>
        </Link>
    );
}

// Grid layout matches FeedGrid, so the two tabs line up.
export function CollectionGrid({ collections }: { collections: CollectionSummary[] }) {
    return (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {collections.map((c) => (
                <li key={c.address}>
                    <CollectionCard collection={c} />
                </li>
            ))}
        </ul>
    );
}
