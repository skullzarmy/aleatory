import Link from "next/link";
import { cn, formatTez } from "@/lib/utils";
import { TimeAgo } from "@/components/TimeAgo";
import type { FeedPiece } from "@/lib/feed";
import { AccountName } from "@/components/account/AccountName";
import { PieceImage } from "./PieceImage";

// The artist and the minter render as AccountName, not a link: the whole
// card is already a link to the piece, and an anchor inside an anchor won't
// hydrate.
export function PieceCard({
    piece,
    artist,
    priceMutez,
}: {
    piece: FeedPiece;
    /** The generator's artist, when the caller has it. `FeedPiece` has no
     * artist of its own, a feed spans many generators and resolving one per
     * piece is the caller's cost to pay, not this component's. */
    artist?: string;
    /** This piece's current listing, when it has one. The grid is pieces from
     * a mint, not pieces for sale, so most calls pass nothing. */
    priceMutez?: bigint;
}) {
    return (
        <Link
            href={`/piece/${piece.contract}/${piece.tokenId}`}
            className="group block overflow-hidden rounded-lg border border-border bg-card-background transition-shadow hover:shadow-lg"
        >
            <div className="relative aspect-square bg-muted">
                <PieceImage src={piece.imageUrl} pending={piece.pending} />
                {priceMutez !== undefined && (
                    <span className="absolute bottom-2 right-2 rounded-md bg-background/90 px-2 py-1 text-sm font-semibold tabular-nums shadow-sm backdrop-blur">
                        {formatTez(priceMutez)} ꜩ
                    </span>
                )}
            </div>

            <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">{piece.name}</p>
                <p className="truncate text-xs text-muted-foreground">{piece.generatorName}</p>
                {artist && (
                    <p className="truncate text-xs font-medium">
                        <AccountName address={artist} />
                    </p>
                )}
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate">
                        {piece.minter && (
                            <>
                                Minted by <AccountName address={piece.minter} />
                            </>
                        )}
                    </span>
                    {piece.mintedAt ? (
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
