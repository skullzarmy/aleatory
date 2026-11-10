/**
 * Provider list and stats tests.
 *
 *   npx tsx src/lib/providers.test.ts
 */
import assert from "node:assert/strict";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
    try {
        await fn();
        console.log(`  ok   ${name}`);
    } catch (e) {
        failures++;
        console.log(`  FAIL ${name} — ${e instanceof Error ? e.message : String(e)}`);
    }
}

function utf8Hex(text: string): string {
    return Buffer.from(text, "utf8").toString("hex");
}

async function run() {
    process.env.NEXT_PUBLIC_TEZOS_NETWORK = "mainnet";
    process.env.NEXT_PUBLIC_REGISTRY_ADDRESS = "KT1E7wraYc1cgywqDQX2KGMNF4TbCADsHVL9";
    process.env.NEXT_PUBLIC_ROUTER_ADDRESS = "KT1HTY5RFTUai5K2Bh2LVySQvSid9Mx2dP4J";

    const { fetchProviders, resetProvidersCacheForTesting } = await import("./providers");
    const { resetRedisClientForTesting } = await import("./cache");

    console.log("\nProviders\n");

    await check("batches mint event lookups and computes median block gap", async () => {
        resetRedisClientForTesting();
        resetProvidersCacheForTesting();

        const providerAddr = "KT1DGd6RcA9zKErjLurg9JGQ8txNCLoFHkmv";
        const agentAddr = "tz1acHymFHm2AAEgLKRgAh9CULY2Kbb4Qnjr";
        const genA = "KT1NmB1z9FpL9KQ2Ju35SqDKMGs13Bc3EDXi";
        const genB = "KT1PWZ57wT2JBoZrxeMF1mbvMGaoictvCTjH";
        const calls: string[] = [];

        const realFetch = globalThis.fetch;
        globalThis.fetch = async (input) => {
            const url = new URL(typeof input === "string" ? input : input.toString());
            calls.push(url.pathname + url.search);

            if (
                url.pathname.endsWith("/router/storage") ||
                url.pathname.includes("KT1HTY5RFTUai5K2Bh2LVySQvSid9Mx2dP4J")
            ) {
                return Response.json({
                    factories: [],
                    marketplace: "",
                    registry: "KT1E7wraYc1cgywqDQX2KGMNF4TbCADsHVL9",
                    resolver: "",
                });
            }
            if (
                url.pathname ===
                "/v1/contracts/KT1E7wraYc1cgywqDQX2KGMNF4TbCADsHVL9/bigmaps/providers/keys"
            ) {
                return Response.json([
                    { key: providerAddr, value: "2026-10-01T20:42:46Z", active: true },
                ]);
            }
            if (url.pathname === `/v1/contracts/${providerAddr}/storage`) {
                return Response.json({ render_gas: "50000", agent: agentAddr, metadata: 1 });
            }
            if (url.pathname === `/v1/contracts/${providerAddr}/bigmaps/metadata/keys/content`) {
                return Response.json({ value: utf8Hex(JSON.stringify({ name: "Aleatory" })) });
            }
            if (url.pathname === "/v1/operations/transactions") {
                return Response.json([
                    {
                        level: 105,
                        timestamp: "2026-11-10T10:00:00Z",
                        target: { address: genA },
                        parameter: { value: { token_id: "0" } },
                    },
                    {
                        level: 220,
                        timestamp: "2026-11-10T10:05:00Z",
                        target: { address: genB },
                        parameter: { value: { token_id: "1" } },
                    },
                    {
                        level: 330,
                        timestamp: "2026-11-10T10:10:00Z",
                        target: { address: genA },
                        parameter: { value: { token_id: "2" } },
                    },
                ]);
            }
            if (url.pathname === "/v1/contracts/events" && url.searchParams.get("tag") === "mint") {
                return Response.json([
                    { contract: { address: genA }, level: 100, payload: { token_id: "0" } },
                    { contract: { address: genB }, level: 210, payload: { token_id: "1" } },
                    { contract: { address: genA }, level: 300, payload: { token_id: "2" } },
                ]);
            }
            if (
                url.pathname === "/v1/contracts/events" &&
                url.searchParams.get("tag") === "set_provider"
            ) {
                return Response.json([]);
            }
            throw new Error(`unexpected fetch: ${url.toString()}`);
        };

        try {
            const list = await fetchProviders();
            assert.equal(list.length, 1);
            assert.equal(list[0].name, "Aleatory");
            assert.equal(list[0].stats.delivered, 3);
            assert.equal(list[0].stats.medianBlocksToPublish, 10);

            const mintQueries = calls.filter(
                (c) => c.includes("/contracts/events") && c.includes("tag=mint"),
            );
            assert.equal(mintQueries.length, 1);
            assert.ok(mintQueries[0].includes("contract.in="));
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    await check(
        "throws on cold registry error and retains lastGood across transient outage",
        async () => {
            resetRedisClientForTesting();
            resetProvidersCacheForTesting();

            const providerAddr = "KT1DGd6RcA9zKErjLurg9JGQ8txNCLoFHkmv";
            let failRegistry = true;
            const realFetch = globalThis.fetch;

            globalThis.fetch = async (input) => {
                const url = new URL(typeof input === "string" ? input : input.toString());
                if (url.pathname.includes("KT1HTY5RFTUai5K2Bh2LVySQvSid9Mx2dP4J")) {
                    return Response.json({
                        factories: [],
                        marketplace: "",
                        registry: "KT1E7wraYc1cgywqDQX2KGMNF4TbCADsHVL9",
                        resolver: "",
                    });
                }
                if (
                    url.pathname ===
                    "/v1/contracts/KT1E7wraYc1cgywqDQX2KGMNF4TbCADsHVL9/bigmaps/providers/keys"
                ) {
                    if (failRegistry) return new Response(null, { status: 404 });
                    return Response.json([
                        { key: providerAddr, value: "2026-10-01T20:42:46Z", active: true },
                    ]);
                }
                if (url.pathname === `/v1/contracts/${providerAddr}/storage`) {
                    return Response.json({
                        render_gas: "50000",
                        agent: "tz1acHymFHm2AAEgLKRgAh9CULY2Kbb4Qnjr",
                        metadata: 1,
                    });
                }
                if (
                    url.pathname === `/v1/contracts/${providerAddr}/bigmaps/metadata/keys/content`
                ) {
                    return Response.json({ value: utf8Hex(JSON.stringify({ name: "Aleatory" })) });
                }
                return Response.json([]);
            };

            try {
                await assert.rejects(() => fetchProviders(), /TzKT 404/);

                failRegistry = false;
                const healthy = await fetchProviders();
                assert.equal(healthy.length, 1);

                resetRedisClientForTesting();
                failRegistry = true;
                const fallback = await fetchProviders();
                assert.equal(fallback.length, 1);
                assert.equal(fallback[0].address, providerAddr);
            } finally {
                globalThis.fetch = realFetch;
            }
        },
    );

    await check(
        "does not cache an empty registry so later registrations appear immediately",
        async () => {
            resetRedisClientForTesting();
            resetProvidersCacheForTesting();

            const providerAddr = "KT1DGd6RcA9zKErjLurg9JGQ8txNCLoFHkmv";
            let empty = true;
            const realFetch = globalThis.fetch;

            globalThis.fetch = async (input) => {
                const url = new URL(typeof input === "string" ? input : input.toString());
                if (url.pathname.includes("KT1HTY5RFTUai5K2Bh2LVySQvSid9Mx2dP4J")) {
                    return Response.json({
                        factories: [],
                        marketplace: "",
                        registry: "KT1E7wraYc1cgywqDQX2KGMNF4TbCADsHVL9",
                        resolver: "",
                    });
                }
                if (
                    url.pathname ===
                    "/v1/contracts/KT1E7wraYc1cgywqDQX2KGMNF4TbCADsHVL9/bigmaps/providers/keys"
                ) {
                    return Response.json(
                        empty
                            ? []
                            : [{ key: providerAddr, value: "2026-10-01T20:42:46Z", active: true }],
                    );
                }
                if (url.pathname === `/v1/contracts/${providerAddr}/storage`) {
                    return Response.json({
                        render_gas: "50000",
                        agent: "tz1acHymFHm2AAEgLKRgAh9CULY2Kbb4Qnjr",
                        metadata: 1,
                    });
                }
                return Response.json([]);
            };

            try {
                const first = await fetchProviders();
                assert.equal(first.length, 0);

                empty = false;
                const second = await fetchProviders();
                assert.equal(second.length, 1);
            } finally {
                globalThis.fetch = realFetch;
            }
        },
    );

    console.log();
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
