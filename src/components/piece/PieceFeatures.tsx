/**
 * A piece's declared traits, under the artwork rather than in the facts
 * rail: a generator can declare as many as it likes, and a sidebar list
 * that long is mostly empty space next to a much shorter artwork. A grid
 * that wraps to however many fit holds any count or length the same way.
 *
 * Room for a rarity percentage per card later — nothing here assumes its
 * absence, just doesn't show one yet.
 */
/** Past this many characters, one column wraps a value three deep before it
 *  reaches the edge. Two columns gives it the width to still read as a card,
 *  not a paragraph. */
const WIDE_AT = 16;

export function PieceFeatures({ features }: { features: { name: string; value: string }[] }) {
    if (features.length === 0) return null;

    return (
        // `dense`: a spanning card leaves a gap in its row otherwise, since
        // grid only looks forward for a cell to fill. Dense packs a later,
        // narrower card back into it — the one bit of real layout work here,
        // and CSS already does it without a masonry library.
        <div className="mt-4 grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] items-start gap-2">
            {features.map((f) => (
                <div
                    key={f.name}
                    className={`rounded-lg border border-border bg-muted/30 p-2.5 text-center ${
                        f.value.length > WIDE_AT ? "col-span-2" : ""
                    }`}
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
