import { cn } from "@/lib/utils";

/**
 * A piece's picture, wherever pieces are listed.
 *
 * A piece that has not been rendered yet still has a picture: until a provider
 * publishes its image, its document is the generator's pending one, and that
 * carries the generator's cover as its `displayUri`. Shown bare under a
 * collector's own token, that cover reads as the piece they minted, which is
 * the confusion this exists to stop.
 *
 * The cover stays — a grid of empty plates says less than a grid of covers —
 * and it is dimmed and labelled as what it is. The piece's own page takes the
 * other road and runs the generator live, because it has room to; a grid has
 * room for a label.
 *
 * Expects a positioned parent: the label is absolute within the plate.
 */
export function PieceImage({
    src,
    pending,
    /** Shown on the plate when there is no picture at all. */
    missingLabel = "Awaiting render",
    /** A thumbnail too small for a sentence. */
    compact = false,
}: {
    src?: string;
    pending?: boolean;
    missingLabel?: string;
    compact?: boolean;
}) {
    // `alt=""` so a failed load collapses onto the plate instead of painting
    // the browser's broken-image glyph; every caller names the link already.
    if (!src) {
        return (
            <div className="pending-shimmer flex h-full w-full items-center justify-center">
                <span className="px-4 text-center text-xs text-muted-foreground">
                    {missingLabel}
                </span>
            </div>
        );
    }

    return (
        <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt=""
                loading="lazy"
                className={cn("h-full w-full object-cover", pending && "opacity-50 saturate-50")}
            />
            {pending &&
                (compact ? (
                    <span className="absolute inset-x-0 bottom-0 bg-background/85 px-1 py-0.5 text-center text-[9px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                        Rendering
                    </span>
                ) : (
                    <span className="absolute inset-x-2 top-2 rounded-md bg-background/85 px-2 py-1 text-center text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                        Rendering — this is the generator&rsquo;s cover, not this piece
                    </span>
                ))}
        </>
    );
}
