import { PieceCard, PieceCardSkeleton } from "./PieceCard";
import type { FeedPiece } from "@/lib/feed";

export function FeedGrid({ pieces }: { pieces: FeedPiece[] }) {
    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {pieces.map((p) => (
                <PieceCard key={p.key} piece={p} />
            ))}
        </div>
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
