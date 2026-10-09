import { PieceCard, PieceCardSkeleton } from "./PieceCard";
import { AutoGrid } from "./AutoGrid";
import type { FeedPiece } from "@/lib/feed";

export function FeedGrid({
    pieces,
    artists,
    prices,
}: {
    pieces: FeedPiece[];
    /** Each piece's generator's artist, keyed by `FeedPiece.contract`. */
    artists?: Map<string, string>;
    /** Active listings among these pieces, keyed the same way `FeedPiece.key` is. */
    prices?: Map<string, bigint>;
}) {
    return (
        <AutoGrid className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {pieces.map((p, i) => (
                <PieceCard
                    key={p.key}
                    piece={p}
                    artist={artists?.get(p.contract)}
                    priceMutez={prices?.get(p.key)}
                    priority={i < 4}
                />
            ))}
        </AutoGrid>
    );
}

export function FeedGridSkeleton({ count = 8 }: { count?: number }) {
    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => (
                <PieceCardSkeleton key={i} />
            ))}
        </div>
    );
}
