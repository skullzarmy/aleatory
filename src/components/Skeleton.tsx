/**
 * The shape of a page before its chain reads land.
 *
 * Every route here waits on an indexer, so a cold page held a blank screen
 * until the whole thing resolved. A `loading.tsx` beside a route hands this
 * back immediately and streams the real content in behind it, which turns a
 * wait into an arrival.
 *
 * It reuses the shimmer an unrendered piece already uses, so waiting looks the
 * same everywhere it happens.
 */
export function SkeletonGrid({ count = 8 }: { count?: number }) {
    return (
        <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
            aria-hidden="true"
        >
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-lg border border-border">
                    <div className="pending-shimmer aspect-square w-full" />
                    <div className="space-y-2 p-3">
                        <div className="pending-shimmer h-4 w-2/3 rounded" />
                        <div className="pending-shimmer h-3 w-1/3 rounded" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function SkeletonPiece() {
    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-hidden="true">
            <div className="pending-shimmer aspect-square w-full min-w-0 rounded-lg border border-border" />
            <div className="min-w-0 space-y-4">
                <div className="pending-shimmer h-6 w-2/3 rounded" />
                <div className="pending-shimmer h-4 w-1/3 rounded" />
                <div className="pending-shimmer h-32 w-full rounded-lg" />
            </div>
        </div>
    );
}

/** What a screen reader is told while any of the above is on screen. */
export function LoadingLabel({ what }: { what: string }) {
    return (
        <p role="status" aria-live="polite" className="sr-only">
            Loading {what}
        </p>
    );
}
