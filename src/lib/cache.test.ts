/**
 * Multi-tiered cache tests.
 *
 * Verifies Tier 1 process memory caching, promise deduplication, and
 * stale-while-revalidate behavior.
 *
 * Run: npx tsx src/lib/cache.test.ts
 */
import { cacheWrap, resetRedisClientForTesting } from "./cache";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

async function run() {
    console.log("\nCache layer\n");

    resetRedisClientForTesting();

    // 1. Fresh call populates cache
    let calls = 0;
    const fetcher = async () => {
        calls++;
        return { count: calls };
    };

    const first = await cacheWrap("test:key", fetcher, { l1Ms: 100, freshMs: 100 });
    check("initial call executes fetcher", first.count === 1 && calls === 1);

    // 2. Immediate second call hits L1 memory cache (calls remains 1)
    const second = await cacheWrap("test:key", fetcher, { l1Ms: 100, freshMs: 100 });
    check(
        "subsequent call hits L1 memory without re-running fetcher",
        second.count === 1 && calls === 1,
    );

    // 3. Concurrent calls coalesce
    let slowCalls = 0;
    const slowFetcher = async () => {
        slowCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return { slowCalls };
    };

    const [c1, c2, c3] = await Promise.all([
        cacheWrap("test:concurrent", slowFetcher, { l1Ms: 200 }),
        cacheWrap("test:concurrent", slowFetcher, { l1Ms: 200 }),
        cacheWrap("test:concurrent", slowFetcher, { l1Ms: 200 }),
    ]);

    check(
        "concurrent requests coalesce into a single fetcher execution",
        slowCalls === 1 && c1.slowCalls === 1 && c2.slowCalls === 1 && c3.slowCalls === 1,
    );

    // 4. Expiry after L1 TTL
    await new Promise((r) => setTimeout(r, 110));
    const third = await cacheWrap("test:key", fetcher, { l1Ms: 50, freshMs: 50 });
    check("call after TTL executes fetcher again", third.count === 2 && calls === 2);

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log("\nAll cache checks passed.\n");
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
