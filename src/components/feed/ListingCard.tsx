import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { AccountName } from "@/components/account/AccountName";
import { CreatorNames } from "@/components/account/CreatorNames";
import { formatTez, shortAddress } from "@/lib/utils";
import type { FeedPiece } from "@/lib/feed";
import type { Listing } from "@/lib/market";
import { PieceImage } from "./PieceImage";

/**
 * One piece for sale: the same card as a feed piece, with the price on it.
 * The artists and the seller render as AccountName, not a link, same as
 * PieceCard: the whole card is already a link, and an anchor inside an
 * anchor won't hydrate.
 *
 * `artists` is its own prop, not read off `piece`: `FeedPiece.minter` is
 * whoever minted this specific token, not necessarily who made the
 * generator or who is selling it now, which is `listing.seller`. All three
 * can be different accounts.
 */
export function ListingCard({
    listing,
    piece,
    artists,
    priority = false,
}: {
    listing: Listing;
    /** Absent when the indexer has not caught up with the token yet. */
    piece?: FeedPiece;
    /** The generator's own creators, looked up separately from the piece. */
    artists?: string[];
    priority?: boolean;
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
                    priority={priority}
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
                <div className="space-y-0.5 pt-1">
                    {artists && artists.length > 0 && (
                        <CreatorNames
                            creators={artists}
                            className="block truncate text-xs font-medium"
                        />
                    )}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="min-w-0 truncate">
                            {listing.seller && (
                                <>
                                    Listed by <AccountName address={listing.seller} />
                                </>
                            )}
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
            </div>
        </Link>
    );
}
