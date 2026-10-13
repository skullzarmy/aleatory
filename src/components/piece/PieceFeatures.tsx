/**
 * A piece's declared traits, under the artwork rather than in the facts
 * rail: a generator can declare as many as it likes, and a sidebar list
 * that long is mostly empty space next to a much shorter artwork. A grid
 * that wraps to however many fit holds any count or length the same way.
 *
 * Room for a rarity percentage per card later — nothing here assumes its
 * absence, just doesn't show one yet.
 */
export function PieceFeatures({ features }: { features: { name: string; value: string }[] }) {
    if (features.length === 0) return null;

    return (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
            {features.map((f) => (
                <div
                    key={f.name}
                    className="rounded-lg border border-border bg-muted/30 p-2.5 text-center"
                >
                    <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {f.name}
                    </p>
                    <p className="mt-0.5 break-words text-sm font-medium">{f.value}</p>
                </div>
            ))}
        </div>
    );
}
