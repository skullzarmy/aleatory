import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { AccountName } from "@/components/account/AccountName";
import { formatTez, shortAddress } from "@/lib/utils";
import type { FeedPiece } from "@/lib/feed";
import type { Listing } from "@/lib/market";

/**
 * One piece for sale.
 *
 * The market was a list of token numbers and prices, which asks somebody to
 * decide whether they want an artwork without showing it to them. It is the
 * same card as a feed piece with the price on it, because the thing being sold
 * is the picture.
 *
 * The seller is a name rather than a link: the whole card is already a link to
 * the piece, and an anchor inside an anchor is invalid HTML.
 */
export function ListingCard({
    listing,
    piece,
}: {
    listing: Listing;
    /** Absent when the indexer has not caught up with the token yet. */
    piece?: FeedPiece;
}) {
    return (
        <Link
            href={`/piece/${listing.collection}/${listing.tokenId}`}
            className="group block overflow-hidden rounded-lg border border-border bg-card-background transition-shadow hover:shadow-lg"
        >
            <div className="relative aspect-square">
                {piece?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={piece.imageUrl}
                        alt={piece.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className="pending-shimmer flex h-full w-full items-center justify-center">
                        <span className="px-4 text-center text-xs text-muted-foreground">
                            {piece ? "Awaiting render" : "Loading"}
                        </span>
                    </div>
                )}

                <span className="absolute bottom-2 right-2 rounded-md bg-background/90 px-2 py-1 text-sm font-semibold tabular-nums shadow-sm backdrop-blur">
                    {formatTez(listing.priceMutez)} ꜩ
                </span>
            </div>

            <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">
                    {piece?.name || `#${Number(listing.tokenId) + 1}`}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                    {piece?.collectionName || shortAddress(listing.collection)}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                    <span className="truncate">
                        <AccountName address={listing.seller} />
                    </span>
                    {piece?.mintedAt ? <TimeAgo iso={piece.mintedAt} /> : <span />}
                </div>
            </div>
        </Link>
    );
}
