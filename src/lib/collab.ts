/**
 * More than one artist on a generator, read into one shape.
 *
 * Collaborations arrived with version 2 of the collection template. Every
 * generator deployed before that has no `collab` and no `template_version`,
 * and the router lists retired factories on purpose, so both shapes are
 * permanently live. This is the only place that difference is handled: a v1
 * generator reads as the one-member collaboration it actually is, and nothing
 * downstream branches on a version or repeats an `administrator` fallback.
 */

/** A collaborator and their share of the mint price, in basis points. */
export interface CollabShare {
    address: string;
    bps: number;
}

export interface Collab {
    /** Who the mint price is divided between. Sums to 10000. */
    shares: CollabShare[];
    /**
     * Who has acknowledged being named, which is who the generator credits.
     * Everyone in `shares` is paid whether they appear here or not.
     */
    confirmed: string[];
}

/** The storage fields this reads. Both optional, which is what v1 looks like. */
export interface CollabStorage {
    administrator: string;
    template_version?: string;
    collab?: { shares?: Record<string, string>; confirmed?: string[] };
}

export function normalizeCollab(storage: CollabStorage): {
    templateVersion: number;
    collab: Collab;
} {
    const templateVersion = Number.parseInt(storage.template_version ?? "1", 10) || 1;
    const raw = storage.collab;

    if (!raw) {
        return {
            templateVersion,
            collab: {
                shares: [{ address: storage.administrator, bps: 10000 }],
                // Confirmed by having deployed it.
                confirmed: [storage.administrator],
            },
        };
    }

    return {
        templateVersion,
        collab: {
            shares: Object.entries(raw.shares ?? {}).map(([address, bps]) => ({
                address,
                bps: Number.parseInt(String(bps), 10) || 0,
            })),
            // Sorted so two reads of one generator credit in the same order.
            confirmed: [...(raw.confirmed ?? [])].sort(),
        },
    };
}

/** Named but not yet confirmed. Counted for display, never listed by name. */
export function unconfirmedCount(collab: Collab): number {
    return Math.max(0, collab.shares.length - collab.confirmed.length);
}
