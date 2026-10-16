export function PieceFeatures({ features }: { features: { name: string; value: string }[] }) {
    if (features.length === 0) return null;

    return (
        <div className="mt-4 flex flex-wrap gap-2">
            {features.map((f) => (
                <div
                    key={f.name}
                    className="min-w-[7rem] max-w-[16rem] flex-auto rounded-lg border border-border bg-muted/30 p-2.5 text-center"
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
