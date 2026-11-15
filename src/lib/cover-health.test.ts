import assert from "node:assert/strict";
import { resolveCoverHealth, resetCoverHealthForTesting } from "./cover-health";

const VALID_CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const VALID_CID_2 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

async function runTests() {
    console.log("\nCover health tests\n");

    // 1. Invalid / empty / non-image URLs never hit fetch
    {
        resetCoverHealthForTesting();
        let calls = 0;
        const fakeFetch: typeof fetch = async () => {
            calls++;
            return new Response(null, { status: 404 });
        };
        const res = await resolveCoverHealth(
            [
                undefined,
                "",
                "not-a-url",
                "javascript:alert(1)",
                "/api/img/too-short",
                "data:text/html;base64,PGgxPkZha2U8L2gxPg==",
                "data:image/png;base64,iVBORw0KGgo=",
            ],
            { fetchFn: fakeFetch },
        );
        assert.equal(calls, 0);
        assert.equal(res.get("not-a-url"), false);
        assert.equal(res.get("javascript:alert(1)"), false);
        assert.equal(res.get("/api/img/too-short"), false);
        assert.equal(res.get("data:text/html;base64,PGgxPkZha2U8L2gxPg=="), false);
        assert.equal(res.get("data:image/png;base64,iVBORw0KGgo="), true);
        console.log("  ok   invalid and data URLs resolve without network calls");
    }

    // 2. Races gateways in parallel and caches in memory
    {
        resetCoverHealthForTesting();
        let calls = 0;
        const fakeFetch: typeof fetch = async (input) => {
            calls++;
            if (String(input).includes("fileship")) {
                return new Response("not found", { status: 404 });
            }
            return new Response(null, {
                status: 200,
                headers: { "content-type": "image/png", "content-length": "2048" },
            });
        };
        const url = `/api/img/${VALID_CID}`;
        const res = await resolveCoverHealth([url], { fetchFn: fakeFetch, maxWaitMs: 5_000 });
        assert.equal(res.get(url), true);
        const callsAfterFirst = calls;
        assert.ok(callsAfterFirst >= 1);

        // Warm L1 cache makes zero network calls
        const res2 = await resolveCoverHealth([url], { fetchFn: fakeFetch, maxWaitMs: 5_000 });
        assert.equal(res2.get(url), true);
        assert.equal(calls, callsAfterFirst);
        console.log("  ok   races gateways in parallel and caches in memory");
    }

    // 3. Rejects non-image content-type (e.g. HTML error page or SVG)
    {
        resetCoverHealthForTesting();
        const fakeFetch: typeof fetch = async () =>
            new Response("<svg></svg>", {
                status: 200,
                headers: { "content-type": "image/svg+xml" },
            });
        const url = `/api/img/${VALID_CID_2}`;
        const res = await resolveCoverHealth([url], { fetchFn: fakeFetch, maxWaitMs: 5_000 });
        assert.equal(res.get(url), false);
        console.log("  ok   rejects non-raster content types");
    }

    // 4. Falls back from HEAD 405 to ranged GET 206
    {
        resetCoverHealthForTesting();
        const methods: string[] = [];
        const fakeFetch: typeof fetch = async (_input, init) => {
            methods.push(init?.method ?? "GET");
            if (init?.method === "HEAD") {
                return new Response(null, { status: 405 });
            }
            return new Response(new Uint8Array([1, 2, 3]), {
                status: 206,
                headers: {
                    "content-type": "image/webp",
                    "content-range": "bytes 0-2/50000",
                },
            });
        };
        const url = "https://example.com/cover.webp";
        const res = await resolveCoverHealth([url], { fetchFn: fakeFetch, maxWaitMs: 5_000 });
        assert.equal(res.get(url), true);
        assert.deepEqual(methods, ["HEAD", "GET"]);
        console.log("  ok   falls back from HEAD 405 to ranged GET");
    }

    // 5. Rejects oversized images
    {
        resetCoverHealthForTesting();
        const fakeFetch: typeof fetch = async () =>
            new Response(null, {
                status: 200,
                headers: {
                    "content-type": "image/png",
                    "content-length": String(20 * 1024 * 1024),
                },
            });
        const url = "https://example.com/huge.png";
        const res = await resolveCoverHealth([url], { fetchFn: fakeFetch, maxWaitMs: 5_000 });
        assert.equal(res.get(url), false);
        console.log("  ok   rejects oversized images");
    }

    // 6. Deduplicates concurrent probes for the same URL
    {
        resetCoverHealthForTesting();
        let calls = 0;
        const fakeFetch: typeof fetch = async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 20));
            return new Response(null, {
                status: 200,
                headers: { "content-type": "image/jpeg", "content-length": "1024" },
            });
        };
        const url = "https://example.com/shared.jpg";
        const [r1, r2] = await Promise.all([
            resolveCoverHealth([url], { fetchFn: fakeFetch, maxWaitMs: 5_000 }),
            resolveCoverHealth([url], { fetchFn: fakeFetch, maxWaitMs: 5_000 }),
        ]);
        assert.equal(r1.get(url), true);
        assert.equal(r2.get(url), true);
        assert.equal(calls, 1);
        console.log("  ok   coalesces concurrent probes for the same URL");
    }

    // 7. Default maxWaitMs (0) returns immediately while slow probes finish in background
    {
        resetCoverHealthForTesting();
        const fakeFetch: typeof fetch = async () => {
            await new Promise((r) => setTimeout(r, 80));
            return new Response(null, {
                status: 200,
                headers: { "content-type": "image/png", "content-length": "1024" },
            });
        };
        const url = "https://example.com/slow.png";
        const res = await resolveCoverHealth([url], { fetchFn: fakeFetch });
        assert.equal(res.get(url), undefined);

        await new Promise((r) => setTimeout(r, 120));
        const res2 = await resolveCoverHealth([url], { fetchFn: fakeFetch });
        assert.equal(res2.get(url), true);
        console.log("  ok   returns immediately by default and completes probe in background");
    }

    console.log("\nAll cover health checks passed.\n");
}

runTests().catch((err) => {
    console.error(err);
    process.exit(1);
});
