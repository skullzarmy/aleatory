/**
 * A piece's declared traits, under the artwork rather than in the facts
 * rail: a generator can declare as many as it likes, and a sidebar list
 * that long is mostly empty space next to a much shorter artwork. Wrapping
 * to however many fit holds any count or length the same way.
 *
 * Room for a rarity percentage per card later — nothing here assumes its
 * absence, just doesn't show one yet.
 */
export function PieceFeatures({ features }: { features: { name: string; value: string }[] }) {
    if (features.length === 0) return null;

    return (
        // Flex, not grid: grid's columns are one fixed width shared by every
        // cell, which is exactly what forced a long value into three lines
        // instead of giving it room. A flex item sizes to its own content —
        // no length to guess at, CSS already knows how wide the text is.
        <div className="mt-4 flex flex-wrap gap-2">
            {features.map((f) => (
                <div
                    key={f.name}
                    className="min-w-[7rem] max-w-[16rem] flex-none rounded-lg border border-border bg-muted/30 p-2.5 text-center"
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
