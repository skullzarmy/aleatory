import { getRedis } from "./cache";
import { NETWORK } from "./config";
import { IPFS_GATEWAYS } from "@/utils/ipfs";

const CID = /^[A-Za-z0-9]{46,64}$/;
const ALLOWED_IMAGE_TYPE = /^image\/(png|jpeg|gif|webp|avif)$/;
const DATA_IMAGE_URI = /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/;
const MAX_BYTES = 16 * 1024 * 1024;

const PROBE_TIMEOUT_MS = 2_000;
const PROBE_CONCURRENCY = 12;
const DEFAULT_MAX_WAIT_MS = 0;

const OK_L1_MS = 60 * 60 * 1_000;
const FAIL_L1_MS = 10 * 60 * 1_000;
const OK_REDIS_SEC = 7 * 24 * 60 * 60;
const FAIL_REDIS_SEC = 10 * 60;

interface CacheEntry {
    ok: boolean;
    expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<boolean>>();

export function resetCoverHealthForTesting(): void {
    memoryCache.clear();
    inFlight.clear();
}

function redisKeyFor(url: string): string {
    return `aleatory:cover-health:${NETWORK}:${url}`;
}

function setMemory(url: string, ok: boolean): void {
    memoryCache.set(url, {
        ok,
        expiresAt: Date.now() + (ok ? OK_L1_MS : FAIL_L1_MS),
    });
}

function totalBytesFromHeaders(headers: Headers): number | null {
    const contentRange = headers.get("content-range");
    if (contentRange) {
        const match = /\/(\d+)$/.exec(contentRange);
        if (match) return Number(match[1]);
    }
    const contentLength = headers.get("content-length");
    if (contentLength !== null) {
        const parsed = Number(contentLength);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

async function probeHttpImage(targetUrl: string, fetchFn: typeof fetch): Promise<boolean> {
    try {
        let res = await fetchFn(targetUrl, {
            method: "HEAD",
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });

        if (
            res.status === 405 ||
            res.status === 501 ||
            (res.ok && !res.headers.get("content-type"))
        ) {
            res.body?.cancel().catch(() => {});
            res = await fetchFn(targetUrl, {
                method: "GET",
                headers: { Range: "bytes=0-1023" },
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            });
        }

        res.body?.cancel().catch(() => {});

        if (!res.ok) return false;

        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!ALLOWED_IMAGE_TYPE.test(type)) return false;

        const totalBytes = totalBytesFromHeaders(res.headers);
        if (totalBytes !== null && (totalBytes <= 0 || totalBytes > MAX_BYTES)) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

function classifyStaticCoverUrl(url: string): boolean | null {
    if (!url) return false;

    if (url.startsWith("/api/img/")) {
        const cid = url.slice("/api/img/".length);
        return CID.test(cid) ? null : false;
    }

    if (url.startsWith("data:")) {
        return DATA_IMAGE_URI.test(url);
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return false;
        }
    } catch {
        return false;
    }

    return null;
}

async function probeCoverUrl(url: string, fetchFn: typeof fetch): Promise<boolean> {
    const staticResult = classifyStaticCoverUrl(url);
    if (staticResult !== null) return staticResult;

    if (url.startsWith("/api/img/")) {
        const cid = url.slice("/api/img/".length);
        try {
            await Promise.any(
                IPFS_GATEWAYS.map(async (gateway) => {
                    const ok = await probeHttpImage(`${gateway}/${cid}`, fetchFn);
                    if (!ok) throw new Error("not ok");
                    return true;
                }),
            );
            return true;
        } catch {
            return false;
        }
    }

    return probeHttpImage(url, fetchFn);
}

/**
 * Checks whether each cover URL resolves to a loadable raster image.
 *
 * Results are cached in process memory and Redis keyed by URL, so warm catalog
 * refreshes perform zero network probes and cold URLs are checked once with
 * bounded concurrency.
 */
export async function resolveCoverHealth(
    coverUrls: (string | undefined)[],
    opts?: { fetchFn?: typeof fetch; maxWaitMs?: number },
): Promise<Map<string, boolean>> {
    const fetchFn = opts?.fetchFn ?? fetch;
    const maxWaitMs = opts?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const result = new Map<string, boolean>();
    const unique = [...new Set(coverUrls.filter((u): u is string => Boolean(u)))];
    if (unique.length === 0) return result;

    const now = Date.now();
    const needRedis: string[] = [];

    for (const url of unique) {
        const staticOk = classifyStaticCoverUrl(url);
        if (staticOk !== null) {
            result.set(url, staticOk);
            continue;
        }
        const cached = memoryCache.get(url);
        if (cached && cached.expiresAt > now) {
            result.set(url, cached.ok);
        } else {
            needRedis.push(url);
        }
    }

    if (needRedis.length === 0) return result;

    const redis = getRedis();
    const needProbe: string[] = [];

    if (redis) {
        try {
            const values = await redis.mget<(boolean | null)[]>(...needRedis.map(redisKeyFor));
            for (let i = 0; i < needRedis.length; i++) {
                const val = values[i];
                if (typeof val === "boolean") {
                    setMemory(needRedis[i], val);
                    result.set(needRedis[i], val);
                } else {
                    needProbe.push(needRedis[i]);
                }
            }
        } catch {
            needProbe.push(...needRedis);
        }
    } else {
        needProbe.push(...needRedis);
    }

    if (needProbe.length === 0) return result;

    const toPersist: { url: string; ok: boolean }[] = [];
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < needProbe.length) {
            const url = needProbe[cursor++];
            let pending = inFlight.get(url);
            if (!pending) {
                pending = probeCoverUrl(url, fetchFn).finally(() => {
                    inFlight.delete(url);
                });
                inFlight.set(url, pending);
            }
            const ok = await pending;
            setMemory(url, ok);
            result.set(url, ok);
            toPersist.push({ url, ok });
        }
    }

    const probeWork = (async () => {
        await Promise.all(
            Array.from({ length: Math.min(PROBE_CONCURRENCY, needProbe.length) }, () => worker()),
        );

        if (redis && toPersist.length > 0) {
            try {
                const pipe = redis.pipeline();
                for (const { url, ok } of toPersist) {
                    pipe.set(redisKeyFor(url), ok, {
                        ex: ok ? OK_REDIS_SEC : FAIL_REDIS_SEC,
                    });
                }
                await pipe.exec();
            } catch {
                // Best-effort persistence; memory cache already holds the results.
            }
        }
    })();

    if (maxWaitMs === 0) {
        void probeWork;
    } else if (maxWaitMs > 0 && Number.isFinite(maxWaitMs)) {
        await Promise.race([
            probeWork,
            new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
        ]);
    } else {
        await probeWork;
    }

    return result;
}
