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

/**
 * How long a stuck mark holds before the next pass gets one more try on its
 * own. Without this, a run of failures that was really an indexer having a
 * rough hour — not an actually broken piece or generator — stayed silenced
 * forever rather than healing once the outage passed, with no sign anything
 * was wrong beyond the one-time log when it first tripped. A genuinely
 * broken target just fails again and re-trips the mark, capped at one more
 * attempt per hour instead of every pass.
 */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

interface Entry {
    attempts: number;
    lastError: string;
    firstFailedAt: string;
    lastFailedAt: string;
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

/**
 * Already failed `STUCK_AFTER` times or more, and still within the hour that
 * earns — skip it. Past that window it is worth one more attempt on its own,
 * whether or not a human ever stepped in.
 */
export function isStuck(key: string): boolean {
    const entry = load()[key];
    if (!entry || entry.attempts < STUCK_AFTER) return false;
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

/** Everything that has hit the cap, for a report. */
export function stuckList(): { key: string; entry: Entry }[] {
    const store = load();
    return Object.entries(store)
        .filter(([, e]) => e.attempts >= STUCK_AFTER)
        .map(([key, entry]) => ({ key, entry }));
}
