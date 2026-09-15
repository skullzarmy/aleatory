import { PieceCard, PieceCardSkeleton } from "./PieceCard";
import { Arrivals, Arriving } from "./Arrivals";
import type { FeedPiece } from "@/lib/feed";

export function FeedGrid({ pieces }: { pieces: FeedPiece[] }) {
    return (
        <Arrivals>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {pieces.map((p) => (
                    <Arriving key={p.key} id={p.key}>
                        <PieceCard piece={p} />
                    </Arriving>
                ))}
            </div>
        </Arrivals>
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
