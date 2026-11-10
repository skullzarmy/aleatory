/**
 * How many times a piece has failed to render, so the daemon stops retrying
 * one that never will and says so, instead of burning a render and a gateway
 * fetch on it every single pass forever.
 *
 * A local file, not a database: this process already has nothing else
 * external to hold state in, and the daemon's own README says copy the
 * directory to a box and run it — a JSON file next to it is the box's own
 * state, not a service to stand up.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".state", "stuck.json");

/** Stop auto-retrying past this many consecutive failures. */
export const STUCK_AFTER = 5;

/** How long a stuck mark holds before the next pass retries on its own. */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

interface Entry {
    attempts: number;
    lastError: string;
    firstFailedAt: string;
    lastFailedAt: string;
    /** Marked by `markPermanent`: the input itself is broken, so no amount of retrying fixes it. */
    permanent?: boolean;
}

type Store = Record<string, Entry>;

function load(filePath = STATE_FILE): Store {
    try {
        return JSON.parse(readFileSync(filePath, "utf8")) as Store;
    } catch {
        return {};
    }
}

function save(store: Store, filePath = STATE_FILE) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(store, null, 2));
}

export function keyFor(generator: string, tokenId: string): string {
    return `${generator}#${tokenId}`;
}

export function isStuck(key: string, filePath = STATE_FILE): boolean {
    const entry = load(filePath)[key];
    if (!entry) return false;
    if (entry.permanent) return true;
    if (entry.attempts < STUCK_AFTER) return false;
    return Date.now() - new Date(entry.lastFailedAt).getTime() < RETRY_AFTER_MS;
}

/** Record a failure. Returns the new attempt count and whether this one tipped it over. */
export function recordFailure(
    key: string,
    error: string,
    filePath = STATE_FILE,
): { attempts: number; justStuck: boolean } {
    const store = load(filePath);
    const now = new Date().toISOString();
    const existing = store[key];
    const attempts = (existing?.attempts ?? 0) + 1;
    store[key] = {
        attempts,
        lastError: error,
        firstFailedAt: existing?.firstFailedAt ?? now,
        lastFailedAt: now,
    };
    save(store, filePath);
    return { attempts, justStuck: attempts === STUCK_AFTER };
}

/** A render that finally worked, or a human fixed it by hand. Clears the count. */
export function recordSuccess(key: string, filePath = STATE_FILE) {
    const store = load(filePath);
    if (!(key in store)) return;
    delete store[key];
    save(store, filePath);
}

/**
 * The input, not the attempt, is what's broken: `provider:retry` is the only
 * way off this, by hand, after whatever made it permanent no longer applies.
 */
export function markPermanent(key: string, error: string, filePath = STATE_FILE): void {
    const store = load(filePath);
    const now = new Date().toISOString();
    const existing = store[key];
    store[key] = {
        attempts: (existing?.attempts ?? 0) + 1,
        lastError: error,
        firstFailedAt: existing?.firstFailedAt ?? now,
        lastFailedAt: now,
        permanent: true,
    };
    save(store, filePath);
}

/**
 * Clear stuck marks for pieces that are no longer pending on chain (for
 * example, published manually or by another pass). When `partial` is true,
 * only pieces up to the highest scanned id are pruned so unreached tokens
 * past the batch cap keep their state.
 */
export function pruneResolved(
    generator: string,
    pendingTokenIds: Iterable<string>,
    opts: { partial?: boolean; filePath?: string } = {},
): number {
    const filePath = opts.filePath ?? STATE_FILE;
    const store = load(filePath);
    const pending = new Set<string>();
    let cutoff = -1;
    for (const id of pendingTokenIds) {
        pending.add(keyFor(generator, id));
        const n = Number(id);
        if (Number.isFinite(n) && n > cutoff) cutoff = n;
    }

    const prefix = `${generator}#`;
    const scanKey = keyFor(generator, "scan");
    let removed = 0;
    for (const key of Object.keys(store)) {
        if (!key.startsWith(prefix) || key === scanKey || pending.has(key)) continue;
        if (opts.partial) {
            const num = Number(key.slice(prefix.length));
            if (!Number.isFinite(num) || num > cutoff) continue;
        }
        delete store[key];
        removed++;
    }
    if (removed > 0) save(store, filePath);
    return removed;
}

/** Everything that has hit the cap, for a report. */
export function stuckList(filePath = STATE_FILE): { key: string; entry: Entry }[] {
    const store = load(filePath);
    return Object.entries(store)
        .filter(([, e]) => e.attempts >= STUCK_AFTER || e.permanent)
        .map(([key, entry]) => ({ key, entry }));
}
