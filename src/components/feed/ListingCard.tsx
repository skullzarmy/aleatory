import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { AccountName } from "@/components/account/AccountName";
import { formatTez, shortAddress } from "@/lib/utils";
import type { FeedPiece } from "@/lib/feed";
import type { Listing } from "@/lib/market";
import { PieceImage } from "./PieceImage";

/**
 * One piece for sale: the same card as a feed piece, with the price on it.
 *
 * The seller is a name and not a link, because the whole card is already a link
 * and an anchor inside an anchor is invalid HTML.
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
            href={`/piece/${listing.generator}/${listing.tokenId}`}
            className="group block overflow-hidden rounded-lg border border-border bg-card-background transition-shadow hover:shadow-lg"
        >
            <div className="relative aspect-square bg-muted">
                <PieceImage
                    src={piece?.imageUrl}
                    pending={piece?.pending}
                    missingLabel={piece ? "Awaiting render" : "Loading"}
                />

                <span className="absolute bottom-2 right-2 rounded-md bg-background/90 px-2 py-1 text-sm font-semibold tabular-nums shadow-sm backdrop-blur">
                    {formatTez(listing.priceMutez)} ꜩ
                </span>
            </div>

            <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">
                    {piece?.name || `#${Number(listing.tokenId) + 1}`}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                    {piece?.generatorName || shortAddress(listing.generator)}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                        <AccountName address={listing.seller} />
                    </span>
                    {piece?.mintedAt ? (
                        <span className="shrink-0">
                            <TimeAgo iso={piece.mintedAt} prefix="minted" short />
                        </span>
                    ) : (
                        <span />
                    )}
                </div>
            </div>
        </Link>
    );
}
