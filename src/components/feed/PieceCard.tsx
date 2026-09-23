import Link from "next/link";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/TimeAgo";
import type { FeedPiece } from "@/lib/feed";
import { AccountName } from "@/components/account/AccountName";
import { PieceImage } from "./PieceImage";

// The artist renders as AccountName, not a link: the whole card is already a
// link to the piece, and an anchor inside an anchor won't hydrate.
export function PieceCard({ piece }: { piece: FeedPiece }) {
    return (
        <Link
            href={`/piece/${piece.contract}/${piece.tokenId}`}
            className="group block overflow-hidden rounded-lg border border-border bg-card-background transition-shadow hover:shadow-lg"
        >
            <div className="relative aspect-square bg-muted">
                <PieceImage src={piece.imageUrl} pending={piece.pending} />
            </div>

            <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">{piece.name}</p>
                <p className="truncate text-xs text-muted-foreground">{piece.generatorName}</p>
                <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                        {piece.artist ? <AccountName address={piece.artist} /> : ""}
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
