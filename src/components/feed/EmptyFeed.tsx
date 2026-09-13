import { BRAND, NETWORK } from "@/lib/config";

export function EmptyFeed({
    reason,
}: {
    reason: "unreachable" | "unconfigured" | "no-generators" | "no-pieces" | "past-the-end";
}) {
    const copy = {
        unreachable: {
            title: "Could not reach the indexer",
            body: `Every piece is on chain and untouched by this. ${BRAND.name} reads them through an indexer, and it did not answer. This page retries on its own.`,
        },
        unconfigured: {
            title: "Nothing deployed yet",
            body: `${BRAND.name}'s contracts are waiting to be originated on ${NETWORK}. The feed turns on once they are.`,
        },
        "no-generators": {
            title: "No generators yet",
            body: "The factory is live and waiting for its first generator.",
        },
        "no-pieces": {
            title: "No pieces minted yet",
            body: "Generators are open. The first mint shows up here.",
        },
        "past-the-end": {
            title: "Nothing on this page",
            body: "There were fewer pieces than this page needed. Step back to the last one with something on it.",
        },
    }[reason];

    return (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <h2 className="text-base font-medium">{copy.title}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy.body}</p>
        </div>
    );
}
