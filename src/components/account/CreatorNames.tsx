"use client";

import { AccountName } from "./AccountName";

/**
 * Who made a generator, on one line.
 *
 * A card has a single line for this and a collaboration can name up to eight
 * people, so only the first is resolved to a name and the rest are counted.
 * Plain text, no link: a card is already a link and an anchor inside an
 * anchor will not hydrate.
 */
export function CreatorNames({ creators, className }: { creators: string[]; className?: string }) {
    if (creators.length === 0) return null;
    const rest = creators.length - 1;
    return (
        <span className={className}>
            <AccountName address={creators[0]} />
            {rest > 0 && ` and ${rest} ${rest === 1 ? "other" : "others"}`}
        </span>
    );
}
