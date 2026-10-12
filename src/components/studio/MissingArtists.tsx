"use client";

import { AccountName } from "@/components/account/AccountName";

/**
 * Artists who are not in a split that is about to be written permanently.
 *
 * Raised on the mint split and on the royalty split, because they are
 * independent maps and leaving somebody out of one is as easy as it is
 * deliberate. A reminder and not a check: an artist who waived the mint and
 * kept royalties, or the reverse, is a real arrangement, and neither map has
 * a setter so the only moment worth saying anything is before the signature.
 *
 * Silent when there are no co-artists, which is most generators and has
 * nothing to forget.
 */
export function MissingArtists({
    missing,
    what,
    onAdd,
    canAdd,
    disabled,
}: {
    missing: string[];
    /** What they would be missing out on, in the artist's words. */
    what: string;
    onAdd: () => void;
    /** False when the remainder is too small to divide into real shares. */
    canAdd: boolean;
    disabled?: boolean;
}) {
    if (missing.length === 0) return null;

    return (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="min-w-0 text-xs text-muted-foreground">
                {missing.length === 1 ? "One of your artists" : `${missing.length} of your artists`}{" "}
                {missing.length === 1 ? "is" : "are"} not here, so {what}:{" "}
                {missing.slice(0, 3).map((a, i) => (
                    <span key={a}>
                        {i > 0 && ", "}
                        <AccountName address={a} />
                    </span>
                ))}
                {missing.length > 3 && ` and ${missing.length - 3} more`}.
            </p>
            <button
                type="button"
                disabled={disabled || !canAdd}
                title={canAdd ? undefined : "Your own share is too small to divide further."}
                onClick={onAdd}
                className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
                {missing.length === 1 ? "Add them" : "Add them all"}
            </button>
        </div>
    );
}
