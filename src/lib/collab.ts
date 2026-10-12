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
     * Which of them the artist named as co-authors. Everyone else in
     * `shares` is taking a cut: paid, and never credited.
     */
    creditable: string[];
    /**
     * Which co-authors have accepted, which is who the generator credits.
     * Everyone in `shares` is paid whether they appear here or not.
     */
    confirmed: string[];
}

/** The storage fields this reads. All optional, which is what v1 looks like. */
export interface CollabStorage {
    administrator: string;
    template_version?: string;
    collab?: {
        shares?: Record<string, string>;
        creditable?: string[];
        confirmed?: string[];
    };
}

/**
 * Whoever holds the generator first, then everyone else alphabetically.
 *
 * Stable, so one generator reads the same way every time, and the head is
 * the person the work is attributed to rather than whichever address sorts
 * lowest: anywhere with room for one name shows that one.
 *
 * The administrator is confirmed from origination and cannot leave the set,
 * so the only way they are missing is a handover to somebody who has not
 * accepted, and plain alphabetical is the honest answer then.
 */
function order(addresses: string[], admin: string): string[] {
    const rest = [...addresses].sort();
    if (!rest.includes(admin)) return rest;
    return [admin, ...rest.filter((a) => a !== admin)];
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
                creditable: [storage.administrator],
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
            creditable: order(raw.creditable ?? [], storage.administrator),
            confirmed: order(raw.confirmed ?? [], storage.administrator),
        },
    };
}

/**
 * Co-authors who have not accepted yet. Counted for display, never listed by
 * name. Measured against `creditable` and not `shares`, because somebody
 * taking a cut was never waiting to accept anything.
 */
export function unconfirmedCount(collab: Collab): number {
    return Math.max(0, collab.creditable.length - collab.confirmed.length);
}

/** Paid, and not one of the people the work is credited to. */
export function paidNotCredited(collab: Collab): CollabShare[] {
    return collab.shares.filter((s) => !collab.creditable.includes(s.address));
}
