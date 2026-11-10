/**
 * Unit tests for provider stuck-state pruning, batched pending scans, and
 * Browser Run error surfacing.
 *
 *   npx tsx provider/provider.test.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BATCH, pendingIn } from "./provider.mts";
import { formatBrowserErrors, render } from "./render.mts";
import {
    isStuck,
    keyFor,
    markPermanent,
    pruneResolved,
    recordFailure,
    stuckList,
    STUCK_AFTER,
} from "./stuck.mts";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
    try {
        await fn();
        console.log(`  ok  ${name}`);
    } catch (e) {
        failures++;
        console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
    }
}

function utf8Hex(text: string): string {
    return Buffer.from(text, "utf8").toString("hex");
}

async function main() {
    console.log("provider stuck pruning, batched scan & render errors");

    const dir = mkdtempSync(join(tmpdir(), "aleatory-stuck-"));
    try {
        await check(
            "pruneResolved drops resolved pieces while keeping pending, scan, and other generators",
            () => {
                const filePath = join(dir, "stuck-1.json");
                const genA = "KT1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
                const genB = "KT1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

                for (let i = 0; i < STUCK_AFTER; i++) {
                    recordFailure(keyFor(genA, "4"), "old error", filePath);
                    recordFailure(keyFor(genA, "5"), "still pending", filePath);
                    recordFailure(keyFor(genB, "0"), "other generator", filePath);
                }
                markPermanent(keyFor(genA, "scan"), "bad code", filePath);

                const removed = pruneResolved(genA, ["5"], { filePath });
                assert.equal(removed, 1);

                const keys = stuckList(filePath).map((entry) => entry.key);
                assert.ok(!keys.includes(keyFor(genA, "4")));
                assert.ok(keys.includes(keyFor(genA, "5")));
                assert.ok(keys.includes(keyFor(genA, "scan")));
                assert.ok(keys.includes(keyFor(genB, "0")));
                assert.equal(isStuck(keyFor(genA, "4"), filePath), false);
            },
        );

        await check(
            "pruneResolved with partial: true leaves tokens above the batch cutoff untouched",
            () => {
                const filePath = join(dir, "stuck-2.json");
                const gen = "KT1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

                for (let i = 0; i < STUCK_AFTER; i++) {
                    recordFailure(keyFor(gen, "1"), "resolved before cutoff", filePath);
                    recordFailure(keyFor(gen, "2"), "still pending", filePath);
                    recordFailure(keyFor(gen, "12"), "above batch cutoff", filePath);
                }

                const removed = pruneResolved(gen, ["2", "9"], { partial: true, filePath });
                assert.equal(removed, 1);

                const keys = stuckList(filePath).map((entry) => entry.key);
                assert.ok(!keys.includes(keyFor(gen, "1")));
                assert.ok(keys.includes(keyFor(gen, "2")));
                assert.ok(keys.includes(keyFor(gen, "12")));
            },
        );

        await check("formatBrowserErrors extracts code and detail cleanly", () => {
            assert.equal(
                formatBrowserErrors([
                    {
                        code: 6002,
                        message: "A timeout was reached.",
                        detail: "Waiting for selector `[data-alea-ready]` failed",
                    },
                ]),
                "[6002] Waiting for selector `[data-alea-ready]` failed",
            );
            assert.equal(formatBrowserErrors([]), "");
            assert.equal(formatBrowserErrors(null), "");
        });

        await check("render surfaces Browser Run 422 error detail alongside status", async () => {
            const realFetch = globalThis.fetch;
            globalThis.fetch = async () =>
                new Response(
                    JSON.stringify({
                        success: false,
                        errors: [
                            {
                                code: 6002,
                                message: "A timeout was reached.",
                                detail: "Waiting for selector `[data-alea-ready]` failed",
                            },
                        ],
                    }),
                    { status: 422, headers: { "content-type": "application/json" } },
                );
            try {
                await assert.rejects(
                    () =>
                        render(
                            { code: "<div></div>", seed: "ooSeed" },
                            { accountId: "acct", apiToken: "tok" },
                        ),
                    /render failed \(422\): \[6002\] Waiting for selector `\[data-alea-ready\]` failed/,
                );
            } finally {
                globalThis.fetch = realFetch;
            }
        });

        await check(
            "pendingIn batches token_metadata reads and skips metadata when idle",
            async () => {
                const realFetch = globalThis.fetch;
                const gen = "KT1FNsrFeER6SQyFHfQ2zJqDvEts3CBkKSD1";
                const admin = "tz1ae2d1BJt7YUqaaec6Xenh3mBqS7VjSZtK";
                const code = "<div>ok</div>";
                const codeHash = createHash("sha256").update(code, "utf8").digest("hex");
                const pendingUri = "ipfs://QmPending";
                let calls: string[] = [];
                let allPublished = false;

                globalThis.fetch = async (input) => {
                    const url = new URL(typeof input === "string" ? input : input.toString());
                    calls.push(url.pathname + url.search);
                    if (url.pathname === `/v1/contracts/${gen}/storage`) {
                        return Response.json({
                            administrator: admin,
                            next_token_id: "3",
                            art: {
                                code: utf8Hex(code),
                                code_encoding: "identity",
                                code_uri: "",
                                code_sealed: true,
                                code_hash: codeHash,
                                pending_metadata: utf8Hex(pendingUri),
                                royalties: { [admin]: "1000" },
                            },
                            render: { provider: "KT1G8ivJQiXNTHBbCSwhTgjSjt5Jp3c8bv6m" },
                        });
                    }
                    if (url.pathname === `/v1/contracts/${gen}/bigmaps/token_metadata/keys`) {
                        return Response.json(
                            allPublished
                                ? [
                                      {
                                          key: "0",
                                          value: {
                                              token_info: { "": utf8Hex("ipfs://QmPublished0") },
                                          },
                                      },
                                  ]
                                : [
                                      {
                                          key: "0",
                                          value: {
                                              token_info: { "": utf8Hex("ipfs://QmPublished0") },
                                          },
                                      },
                                      {
                                          key: "10",
                                          value: { token_info: { "": utf8Hex(pendingUri) } },
                                      },
                                      {
                                          key: "2",
                                          value: { token_info: { "": utf8Hex(pendingUri) } },
                                      },
                                  ],
                        );
                    }
                    if (url.pathname.includes("/bigmaps/metadata/keys/")) {
                        if (url.pathname.endsWith("/content")) {
                            return Response.json({
                                value: utf8Hex(JSON.stringify({ name: "Test" })),
                            });
                        }
                        return new Response(null, { status: 204 });
                    }
                    if (url.pathname === "/v1/contracts/events") {
                        const id = url.searchParams.get("payload.token_id");
                        return Response.json([
                            {
                                payload: { token_id: id, params: "" },
                                transactionId: Number(id) + 100,
                            },
                        ]);
                    }
                    if (url.pathname === "/v1/operations/transactions") {
                        const txId = Number(url.searchParams.get("id"));
                        return Response.json([`ooSeed${txId}`]);
                    }
                    throw new Error(`unexpected fetch: ${url.toString()}`);
                };

                try {
                    const pieces = await pendingIn(gen);
                    assert.equal(pieces.length, 2);
                    assert.deepEqual(
                        pieces.map((p) => p.tokenId),
                        ["2", "10"],
                    );
                    assert.ok(BATCH >= pieces.length);
                    assert.equal(
                        calls.filter((c) => c.includes("/bigmaps/token_metadata/keys")).length,
                        1,
                    );

                    calls = [];
                    allPublished = true;
                    const idle = await pendingIn(gen);
                    assert.equal(idle.length, 0);
                    assert.equal(
                        calls.filter((c) => c.includes("/bigmaps/metadata/keys/")).length,
                        0,
                    );
                    assert.equal(calls.filter((c) => c.includes("/contracts/events")).length, 0);
                } finally {
                    globalThis.fetch = realFetch;
                }
            },
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
