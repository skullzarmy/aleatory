/**
 * What to call an address.
 *
 * A tz1 is not a name, and a page full of them tells a collector nothing about
 * who made or holds anything. Three sources, in this order:
 *
 *   1. The Tezos Domains reverse record. There is at most one, it is set
 *      deliberately by the holder, and it points at their wallet rather than
 *      being merely owned by it. That makes it the closest thing to a declared
 *      identity, so it wins.
 *   2. A hack.tez subdomain they own. There is no primary flag yet, so the
 *      first one is taken.
 *   3. Their TzKT profile alias.
 *
 * The first two come from hack.tez's resolver in one call, whose `primary`
 * field is already that order. Its answers are CDN-cached, which matters when
 * a feed asks about forty addresses at once.
 *
 * Resolution is against mainnet regardless of the network the site is pointed
 * at, because a key is the same key on every chain and someone's name should
 * not disappear when they are testing. The alias is the exception: that is a
 * per-instance TzKT profile, so it comes from the network in use.
 */
import { tzktApi } from "./config";

const RESOLVER = process.env.NEXT_PUBLIC_HACKTEZ_API || "https://hacktez.com";

/** Long enough that a feed costs one request per address, short enough that a
 *  name set this morning shows up today. */
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 4_000;

interface Cached {
    name: string | null;
    at: number;
}

const cache = new Map<string, Cached>();
/** In-flight requests, so a grid of forty pieces by one artist asks once. */
const inflight = new Map<string, Promise<string | null>>();

/**
 * How many addresses may be in flight at once.
 *
 * A feed of forty cards by forty different artists is forty lookups, and
 * firing them together buries the requests that actually matter, the chain
 * reads, behind a queue of decoration. Names arrive progressively instead,
 * which costs nothing: every one of them is already showing an address.
 */
const MAX_CONCURRENT = 6;
let active = 0;
const queue: (() => void)[] = [];

async function gate<T>(run: () => Promise<T>): Promise<T> {
    if (active >= MAX_CONCURRENT) {
        await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
        return await run();
    } finally {
        active--;
        queue.shift()?.();
    }
}

async function timed(url: string): Promise<Response | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: abort.signal });
        return res.ok ? res : null;
    } catch {
        // A name is decoration. Nothing here is worth failing a page over.
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function lookup(address: string): Promise<string | null> {
    const res = await timed(`${RESOLVER}/api/v1/resolve/${address}`);
    if (res) {
        const body = (await res.json().catch(() => null)) as {
            primary?: string | null;
            hackTez?: string[];
        } | null;
        const name = body?.primary ?? body?.hackTez?.[0] ?? null;
        if (name) return name;
    }

    const account = await timed(`${tzktApi()}/v1/accounts/${address}`);
    if (account) {
        const body = (await account.json().catch(() => null)) as { alias?: string } | null;
        if (body?.alias) return body.alias;
    }

    return null;
}

/**
 * The best name for an address, or null when it has none.
 *
 * Callers show the truncated address when this is null rather than being given
 * one, so that the decision of how to abbreviate stays with the surface doing
 * the rendering.
 */
export async function resolveName(address: string): Promise<string | null> {
    if (!address) return null;

    const hit = cache.get(address);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.name;

    const pending = inflight.get(address);
    if (pending) return pending;

    const run = gate(() => lookup(address))
        .then((name) => {
            cache.set(address, { name, at: Date.now() });
            return name;
        })
        .catch(() => null)
        .finally(() => inflight.delete(address));

    inflight.set(address, run);
    return run;
}
