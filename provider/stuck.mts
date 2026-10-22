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

function load(): Store {
    try {
        return JSON.parse(readFileSync(STATE_FILE, "utf8")) as Store;
    } catch {
        return {};
    }
}

function save(store: Store) {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(store, null, 2));
}

export function keyFor(generator: string, tokenId: string): string {
    return `${generator}#${tokenId}`;
}

export function isStuck(key: string): boolean {
    const entry = load()[key];
    if (!entry) return false;
    if (entry.permanent) return true;
    if (entry.attempts < STUCK_AFTER) return false;
    return Date.now() - new Date(entry.lastFailedAt).getTime() < RETRY_AFTER_MS;
}

/** Record a failure. Returns the new attempt count and whether this one tipped it over. */
export function recordFailure(
    key: string,
    error: string,
): { attempts: number; justStuck: boolean } {
    const store = load();
    const now = new Date().toISOString();
    const existing = store[key];
    const attempts = (existing?.attempts ?? 0) + 1;
    store[key] = {
        attempts,
        lastError: error,
        firstFailedAt: existing?.firstFailedAt ?? now,
        lastFailedAt: now,
    };
    save(store);
    return { attempts, justStuck: attempts === STUCK_AFTER };
}

/** A render that finally worked, or a human fixed it by hand. Clears the count. */
export function recordSuccess(key: string) {
    const store = load();
    if (!(key in store)) return;
    delete store[key];
    save(store);
}

/**
 * The input, not the attempt, is what's broken: `provider:retry` is the only
 * way off this, by hand, after whatever made it permanent no longer applies.
 */
export function markPermanent(key: string, error: string): void {
    const store = load();
    const now = new Date().toISOString();
    const existing = store[key];
    store[key] = {
        attempts: (existing?.attempts ?? 0) + 1,
        lastError: error,
        firstFailedAt: existing?.firstFailedAt ?? now,
        lastFailedAt: now,
        permanent: true,
    };
    save(store);
}

/** Everything that has hit the cap, for a report. */
export function stuckList(): { key: string; entry: Entry }[] {
    const store = load();
    return Object.entries(store)
        .filter(([, e]) => e.attempts >= STUCK_AFTER || e.permanent)
        .map(([key, entry]) => ({ key, entry }));
}
