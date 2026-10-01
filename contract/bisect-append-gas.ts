#!/usr/bin/env npx tsx
/**
 * Measure the real on-chain gas `append_code` needs as accumulated code
 * grows, to calibrate `ops.ts`'s fixed `gas: 30_000` before mainnet.
 *
 * `append_code` does `code = sp.concat([code, chunk])`, so cost scales with
 * the *total* code stored, not just the new chunk. The studio's walked route
 * now allows up to 8 chunks near 32,768 bytes each (`src/lib/plan.ts`), so the
 * late chunks in a full walk are concatenating onto ~200KB+ of existing code,
 * far past what the flat 30,000 gas limit was ever tuned for.
 *
 * This deploys a throwaway empty generator on shadownet and walks it with
 * max-size random chunks, submitting each at a generous gas limit (75% of the
 * chain's per-operation ceiling, so it always lands regardless of the real
 * cost) and reading back the gas TzKT reports was actually consumed. Fee is
 * charged on the *declared* limit, not gas used, so a generous limit only
 * costs a bit more fee here, not correctness.
 *
 *   npx tsx contract/bisect-append-gas.ts
 *
 * Env: TEZOS_WALLET_PRIV_KEY (funded shadownet key). Takes several minutes:
 * 9 real operations (1 deploy + 8 appends), each waiting for confirmation.
 */
import "dotenv/config";
import { TezosToolkit, MichelsonMap } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { feeFor } from "../provider/fees";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.TEZOS_RPC || "https://rpc.tzkt.io/shadownet";
const TZKT_API = "https://api.shadownet.tzkt.io";

/** src/lib/plan.ts: the walked route's per-chunk ceiling and chunk count. */
const MAX_CHUNK_BYTES = 32_768 - 1_200;
const CHUNKS = 8;

function deployments(): Record<string, string> {
    const p = resolve(__dirname, "deployments", "shadownet.json");
    return JSON.parse(readFileSync(p, "utf-8"));
}

async function packedBytes(value: unknown): Promise<number> {
    const { packDataBytes } = await import("@taquito/michel-codec");
    return packDataBytes(value as never).bytes.length / 2;
}

async function generatorFromDeploy(hash: string, timeoutMs = 120_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await fetch(`${TZKT_API}/v1/operations/${hash}`).catch(() => null);
        if (res?.ok) {
            const rows = (await res.json()) as {
                type?: string;
                originatedContract?: { address?: string };
            }[];
            const address = rows.find((r) => r.type === "origination")?.originatedContract?.address;
            if (address) return address;
        }
        await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(`Deploy op ${hash} did not confirm in time.`);
}

/** TzKT indexes a couple seconds behind head, so poll rather than read once. */
async function gasUsed(hash: string, timeoutMs = 60_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await fetch(`${TZKT_API}/v1/operations/${hash}`).catch(() => null);
        if (res?.ok) {
            const rows = (await res.json()) as {
                type?: string;
                gasUsed?: number;
                status?: string;
                errors?: unknown;
            }[];
            const row = rows.find((r) => r.type === "transaction");
            if (row) {
                if (row.status !== "applied") {
                    throw new Error(
                        `Op ${hash} did not apply: ${JSON.stringify(row.errors ?? row)}`,
                    );
                }
                return row.gasUsed ?? 0;
            }
        }
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`No transaction row for ${hash} after ${timeoutMs}ms`);
}

/** Length of the code already stored, in bytes, so a walk can resume. */
async function codeLength(generator: string): Promise<number> {
    const res = await fetch(`${TZKT_API}/v1/contracts/${generator}/storage`);
    const storage = (await res.json()) as { art?: { code?: string } };
    const hex = storage.art?.code ?? "";
    return hex.length / 2;
}

async function main() {
    const secretKey = process.env.TEZOS_WALLET_PRIV_KEY;
    if (!secretKey) throw new Error("Set TEZOS_WALLET_PRIV_KEY.");

    const { factory, provider } = deployments();
    if (!factory || !provider)
        throw new Error("contract/deployments/shadownet.json is missing factory/provider.");

    const tezos = new TezosToolkit(RPC_URL);
    const signer = await InMemorySigner.fromSecretKey(secretKey);
    tezos.setSignerProvider(signer);

    const constants = (await tezos.rpc.getConstants()) as unknown as {
        hard_gas_limit_per_operation: { toNumber(): number };
        hard_gas_limit_per_block: { toNumber(): number };
    };
    const ceiling = Math.min(
        constants.hard_gas_limit_per_operation.toNumber(),
        constants.hard_gas_limit_per_block.toNumber(),
    );
    const GENEROUS_GAS = Math.floor(ceiling * 0.75);
    console.log(`gas ceiling: ${ceiling} (per op / per block, on shadownet these are equal)`);
    console.log(`using ${GENEROUS_GAS} as the declared limit for every call\n`);

    // 1. Deploy an empty, unsealed generator to walk — unless one was passed
    // in to resume (`--resume KT1...`), in which case pick up where it left off.
    const resumeArg = process.argv.find((_a, i) => process.argv[i - 1] === "--resume");
    let generator: string;
    let at: number;
    if (resumeArg) {
        generator = resumeArg;
        at = await codeLength(generator);
        console.log(`resuming ${generator} at offset ${at}\n`);
    } else {
        const codeHash = createHash("sha256").update("bisect-append-gas placeholder").digest("hex");
        const factoryContract = await tezos.contract.at(factory);
        const deployParams = {
            code: "",
            code_encoding: "identity",
            code_hash: codeHash,
            code_uri: "",
            edition_size: 0,
            price: "0",
            royalties: new MichelsonMap(),
            pending_metadata: Buffer.from("ipfs://bisect-placeholder", "utf-8").toString("hex"),
            start_paused: true,
            trust_resolver: true,
            provider,
            // The provider's own quote, read from its storage (render_gas:
            // "50000" on shadownet right now), plus room so a future change
            // doesn't retrigger PRICE_ABOVE_MAX.
            max_render_gas: "100000",
            metadata: new MichelsonMap(),
        };
        const deployTransfer = factoryContract.methodsObject
            .deploy(deployParams)
            .toTransferParams();
        const deployBytes = await packedBytes(deployTransfer.parameter!.value);
        console.log("deploying throwaway generator...");
        const deployOp = await factoryContract.methodsObject.deploy(deployParams).send({
            fee: feeFor({ gas: GENEROUS_GAS, bytes: deployBytes }),
            gasLimit: GENEROUS_GAS,
            storageLimit: 20_000,
        });
        console.log(`  injected: ${deployOp.hash}`);
        await deployOp.confirmation();
        generator = await generatorFromDeploy(deployOp.hash);
        at = 0;
        console.log(`  generator: ${generator}`);
        console.log(`  https://shadownet.tzkt.io/${generator}`);
        console.log(`  deploy gas used: ${await gasUsed(deployOp.hash)}\n`);
    }

    // 2. Walk it with max-size chunks, recording actual gas used per chunk.
    const generatorContract = await tezos.contract.at(generator);
    const results: { chunk: number; at: number; totalAfter: number; gasUsed: number }[] = [];
    const startChunk = Math.round(at / MAX_CHUNK_BYTES);
    const remaining = CHUNKS - startChunk;

    for (let i = 0; i < remaining; i++) {
        const chunk = randomBytes(MAX_CHUNK_BYTES).toString("hex");
        const call = generatorContract.methodsObject.append_code({ chunk, at });
        const appendBytes = await packedBytes(call.toTransferParams().parameter!.value);

        console.log(
            `chunk ${startChunk + i + 1}/${CHUNKS} (at=${at}, total after=${at + MAX_CHUNK_BYTES})`,
        );
        const op = await call.send({
            fee: feeFor({ gas: GENEROUS_GAS, bytes: appendBytes }),
            gasLimit: GENEROUS_GAS,
            storageLimit: MAX_CHUNK_BYTES + 1_000,
        });
        console.log(`  injected: ${op.hash}`);
        await op.confirmation();
        const used = await gasUsed(op.hash);
        console.log(`  gas used: ${used}\n`);

        results.push({ chunk: i + 1, at, totalAfter: at + MAX_CHUNK_BYTES, gasUsed: used });
        at += MAX_CHUNK_BYTES;
    }

    console.log("chunk\tat\ttotalAfter\tgasUsed");
    for (const r of results) console.log(`${r.chunk}\t${r.at}\t${r.totalAfter}\t${r.gasUsed}`);

    // Linear fit: gasUsed ~= a + b * totalAfter, so ops.ts can scale gas the
    // same way it already scales storage.
    const n = results.length;
    const sumX = results.reduce((s, r) => s + r.totalAfter, 0);
    const sumY = results.reduce((s, r) => s + r.gasUsed, 0);
    const sumXY = results.reduce((s, r) => s + r.totalAfter * r.gasUsed, 0);
    const sumXX = results.reduce((s, r) => s + r.totalAfter * r.totalAfter, 0);
    const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const a = (sumY - b * sumX) / n;
    console.log(`\nfit: gas ~= ${a.toFixed(1)} + ${b.toFixed(6)} * totalBytesAfter`);
    const worst = CHUNKS * MAX_CHUNK_BYTES;
    console.log(`worst case (${worst} bytes, full 8-chunk walk): ~${Math.ceil(a + b * worst)} gas`);
    console.log(`(chain ceiling is ${ceiling} gas per operation)`);
}

main().catch((e) => {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
});
