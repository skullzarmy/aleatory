import Link from "next/link";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/TimeAgo";
import type { FeedPiece } from "@/lib/feed";
import { AccountName } from "@/components/account/AccountName";

/**
 * One piece in a feed.
 *
 * A piece awaiting its render shows an "awaiting render" state. It is a real
 * token, owned and tradeable, and the card says so.
 *
 * The artist is a name, not a link. The whole card is already a link to the
 * piece, and an anchor inside an anchor is invalid HTML that React refuses to
 * hydrate. Where a card is the link, accounts render as AccountName.
 */
export function PieceCard({ piece }: { piece: FeedPiece }) {
    return (
        <Link
            href={`/piece/${piece.contract}/${piece.tokenId}`}
            className="group block overflow-hidden rounded-lg border border-border bg-card-background transition-shadow hover:shadow-lg"
        >
            {/* The plate matters: an image that fails to load collapses to it
                instead of painting the browser's broken glyph into the grid.
                `alt=""` is what makes it collapse, and the name is already the
                first line of the card, so the link is named without it. */}
            <div className="relative aspect-square bg-muted">
                {piece.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={piece.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className="pending-shimmer flex h-full w-full items-center justify-center">
                        <span className="px-4 text-center text-xs text-muted-foreground">
                            Awaiting render
                        </span>
                    </div>
                )}
            </div>

            <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">{piece.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                    {piece.collectionName}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                        {piece.artist ? <AccountName address={piece.artist} /> : ""}
                    </span>
                    {piece.mintedAt ? (
                        <span className="shrink-0">
                            <TimeAgo iso={piece.mintedAt} />
                        </span>
                    ) : (
                        <span />
                    )}
                </div>
            </div>
        </Link>
    );
}

export function PieceCardSkeleton({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "overflow-hidden rounded-lg border border-border bg-card-background",
                className,
            )}
        >
            <div className="pending-shimmer aspect-square" />
            <div className="space-y-2 p-3">
                <div className="h-4 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
        </div>
    );
}
