import { BRAND, NETWORK } from "@/lib/config";

/**
 * Three different kinds of nothing, told apart.
 *
 * "We have not deployed yet", "nobody has made a collection", and "something
 * broke" are distinct facts, and collapsing them into one blank grid is how a
 * site becomes untrustworthy.
 */
export function EmptyFeed({
    reason,
}: {
    reason: "unconfigured" | "no-collections" | "no-pieces";
}) {
    const copy = {
        unconfigured: {
            title: "Nothing deployed yet",
            body: `${BRAND.name}'s contracts have not been originated on ${NETWORK}. The feed turns on by itself once they are.`,
        },
        "no-collections": {
            title: "No collections yet",
            body: "The factory is live and no artist has deployed a collection through it. This is the first day.",
        },
        "no-pieces": {
            title: "No pieces minted yet",
            body: "Collections exist and nobody has bought a piece from one. The first mint shows up here.",
        },
    }[reason];

    return (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <h2 className="text-base font-medium">{copy.title}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {copy.body}
            </p>
        </div>
    );
}
