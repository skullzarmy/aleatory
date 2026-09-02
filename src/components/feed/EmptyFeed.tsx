import { BRAND, NETWORK } from "@/lib/config";

/**
 * Three kinds of nothing, each told apart: nothing deployed, no collections,
 * no pieces. Each is a distinct fact and the copy states which one it is.
 */
export function EmptyFeed({ reason }: { reason: "unconfigured" | "no-collections" | "no-pieces" }) {
    const copy = {
        unconfigured: {
            title: "Nothing deployed yet",
            body: `${BRAND.name}'s contracts are waiting to be originated on ${NETWORK}. The feed turns on once they are.`,
        },
        "no-collections": {
            title: "No collections yet",
            body: "The factory is live and waiting for its first collection.",
        },
        "no-pieces": {
            title: "No pieces minted yet",
            body: "Collections are open. The first mint shows up here.",
        },
    }[reason];

    return (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <h2 className="text-base font-medium">{copy.title}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy.body}</p>
        </div>
    );
}
