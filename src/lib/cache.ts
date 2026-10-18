/**
 * Multi-tiered cache for chain queries.
 *
 * Tier 1: Process memory (Map) with request deduplication.
 * Tier 2: Upstash Redis over REST (when configured) with stale-while-revalidate.
 *
 * Warm serverless containers serve from process memory with zero Redis commands.
 * Cold starts query Redis with a single read, returning cached data immediately
 * if present and revalidating in the background. If Redis is unconfigured or
 * unreachable, queries fall back to process memory and direct chain execution.
 */
import { Redis } from "@upstash/redis";
import { NETWORK } from "./config";

interface Envelope<T> {
    data: T;
    timestamp: number;
}

export interface CacheOptions<T = unknown> {
    /** Milliseconds until cached data is considered stale. Default: 30,000 (30s). */
    freshMs?: number;
    /** Milliseconds to retain in process memory. Default: 15,000 (15s). */
    l1Ms?: number;
    /** Time-to-live in seconds in Redis. Default: 86,400 (24 hours). */
    redisTtlSec?: number;
    /** Whether stale data is OK to hand out while a fresh copy is fetched in
     *  the background. Defaults to yes. `false` waits for the fresh fetch. */
    staleOk?: (data: T) => boolean;
}

const memoryCache = new Map<string, { at: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();
const backgroundRevalidations = new Set<string>();

let redisClient: Redis | null | undefined = undefined;

export function getRedis(): Redis | null {
    if (redisClient !== undefined) return redisClient;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
        try {
            redisClient = new Redis({ url, token });
        } catch {
            redisClient = null;
        }
    } else {
        redisClient = null;
    }
    return redisClient;
}

/** Reset the cached Redis client instance (primarily for tests). */
export function resetRedisClientForTesting() {
    redisClient = undefined;
    memoryCache.clear();
    inFlight.clear();
    backgroundRevalidations.clear();
}

/**
 * Wraps an asynchronous query with Tier 1 process memory and Tier 2 Redis SWR.
 */
/**
 * The shape of what is cached, not the cache's own version.
 *
 * Entries outlive a deploy: Redis holds them for a day and the key says
 * nothing about the shape of the value, so code that changed a cached type
 * reads back the old one and falls over on a field that is now missing. A
 * piece cached as `artist: string` and read as `artists: string[]` is a 500
 * on every piece page, for a day, for exactly the pieces that were popular
 * enough to be cached.
 *
 * **Bump this whenever a cached type changes.** It costs one cold fetch per
 * key and is the only thing standing between a type change and an outage.
 */
const SCHEMA = 3;

export async function cacheWrap<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts: CacheOptions<T> = {},
): Promise<T> {
    const fullKey = `aleatory:v${SCHEMA}:${NETWORK}:${key}`;
    const freshMs = opts.freshMs ?? 30_000;
    const l1Ms = opts.l1Ms ?? 15_000;
    const redisTtlSec = opts.redisTtlSec ?? 86_400;
    const staleOk = opts.staleOk ?? (() => true);

    // Tier 1: Check process memory.
    const mem = memoryCache.get(fullKey);
    const now = Date.now();
    if (mem && now - mem.at < l1Ms && staleOk(mem.value as T)) {
        return mem.value as T;
    }

    // Coalesce concurrent calls for the same key within this process.
    const active = inFlight.get(fullKey);
    if (active) {
        return active as Promise<T>;
    }

    const promise = (async () => {
        const redis = getRedis();

        // Tier 2: Check Redis if configured.
        if (redis) {
            try {
                const cached = await redis.get<Envelope<T>>(fullKey);
                if (cached && cached.data !== undefined) {
                    const age = Date.now() - cached.timestamp;
                    memoryCache.set(fullKey, { at: Date.now(), value: cached.data });

                    if (age < freshMs) {
                        return cached.data;
                    }

                    if (staleOk(cached.data)) {
                        // Stale while revalidate: return cached data now, refresh in background.
                        triggerBackgroundRevalidation(fullKey, fetcher, redis, redisTtlSec);
                        return cached.data;
                    }
                    // Otherwise fall through and await the fresh fetch below.
                }
            } catch {
                // Redis error: fall through to direct fetch.
            }
        }

        // Cache miss or Redis unavailable: fetch from origin.
        const fresh = await fetcher();
        memoryCache.set(fullKey, { at: Date.now(), value: fresh });

        if (redis) {
            const envelope: Envelope<T> = { data: fresh, timestamp: Date.now() };
            redis.set(fullKey, envelope, { ex: redisTtlSec }).catch(() => {});
        }

        return fresh;
    })();

    inFlight.set(fullKey, promise);
    try {
        return await promise;
    } finally {
        inFlight.delete(fullKey);
    }
}

function triggerBackgroundRevalidation<T>(
    fullKey: string,
    fetcher: () => Promise<T>,
    redis: Redis,
    redisTtlSec: number,
) {
    if (backgroundRevalidations.has(fullKey)) return;
    backgroundRevalidations.add(fullKey);

    (async () => {
        try {
            const fresh = await fetcher();
            memoryCache.set(fullKey, { at: Date.now(), value: fresh });
            const envelope: Envelope<T> = { data: fresh, timestamp: Date.now() };
            await redis.set(fullKey, envelope, { ex: redisTtlSec });
        } catch {
            // Keep stale cache on background revalidation failure.
        } finally {
            backgroundRevalidations.delete(fullKey);
        }
    })();
}
