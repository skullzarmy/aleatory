#!/usr/bin/env npx tsx
/**
 * Deploy a collection through the factory, then buy a piece from it.
 *
 *   npx tsx contract/deploy-collection.ts [--dry-run] [--network shadownet]
 *                                         [--buy] [--price 1000000]
 *
 * This is the artist path and the collector path, run once, to answer the
 * three numbers that no amount of local compilation can:
 *
 *   1. what a collection costs an artist to deploy
 *   2. what a mint costs a collector on top of price + render gas
 *   3. whether any of it fits inside a single operation
 *
 * It goes through the real factory, because the one-signature deploy is the
 * thing being measured.
 *
 * Env: as contract/deploy.ts, plus
 *   ALEA_CODE_URI          ipfs:// pointer to the generator (required)
 *   ALEA_CODE_SHA256       hex sha256 of the generator bytes (required)
 *   ALEA_PENDING_METADATA  ipfs:// pointer to the "not revealed yet" document
 *   ALEA_EDITION_SIZE      0 for an open edition (default 10)
 *   ALEA_ROYALTY_BPS       total royalty, basis points (default 1000 = 10%)
 */
import "dotenv/config";
import { TezosToolkit, MichelsonMap } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const networkArg = process.argv.find((_a, i) => process.argv[i - 1] === "--network");
const NETWORK = networkArg || process.env.TEZOS_NETWORK || "shadownet";
const DRY_RUN = process.argv.includes("--dry-run");
const DO_BUY = process.argv.includes("--buy");
const priceArg = process.argv.find((_a, i) => process.argv[i - 1] === "--price");

const DEFAULT_RPC: Record<string, string> = {
    shadownet: "https://rpc.tzkt.io/shadownet",
    mainnet: "https://rpc.tzkt.io/mainnet",
};
const TZKT: Record<string, string> = { shadownet: "shadownet.tzkt.io", mainnet: "tzkt.io" };
const RPC_URL = process.env.TEZOS_RPC || DEFAULT_RPC[NETWORK];

function deployments(): Record<string, string> {
    const p = resolve(__dirname, "deployments", `${NETWORK}.json`);
    if (!existsSync(p))
        throw new Error(`No deployments for ${NETWORK}. Run contract/deploy.ts first.`);
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, string>;
}

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
        // Immutable once the collection exists, so a missing value has to stop
        // the run.
        throw new Error(`${name} is not set, and it can never be changed after deploy.`);
    }
    return v;
}

async function main() {
    const secretKey = process.env.TEZOS_WALLET_PRIV_KEY;
    if (!secretKey || !/^(edsk|spsk|p2sk)/.test(secretKey)) {
        console.error("Set TEZOS_WALLET_PRIV_KEY.");
        process.exit(1);
    }
    const tezos = new TezosToolkit(RPC_URL);
    const signer = await InMemorySigner.fromSecretKey(secretKey);
    tezos.setSignerProvider(signer);
    const artist = await signer.publicKeyHash();

    const d = deployments();
    if (!d.factory) throw new Error("No factory deployed. Run contract/deploy.ts.");
    if (!d.provider) throw new Error("No provider deployed. Run contract/deploy.ts.");

    const codeUri = requireEnv("ALEA_CODE_URI");
    const codeHashHex = requireEnv("ALEA_CODE_SHA256").replace(/^0x/, "");
    const pending = process.env.ALEA_PENDING_METADATA || "ipfs://QmPendingPlaceholder";
    const editionSize = parseInt(process.env.ALEA_EDITION_SIZE || "10", 10);
    const royaltyBps = parseInt(process.env.ALEA_ROYALTY_BPS || "1000", 10);
    const price = parseInt(priceArg || process.env.ALEA_PRICE_MUTEZ || "1000000", 10);

    if (royaltyBps > 2500)
        throw new Error(`ALEA_ROYALTY_BPS=${royaltyBps} exceeds the contract's 25% cap.`);

    const hex = (s: string) => Buffer.from(s, "utf-8").toString("hex");
    const royalties = new MichelsonMap<string, number>();
    if (royaltyBps > 0) royalties.set(artist, royaltyBps);

    const collectionMeta = new MichelsonMap<string, string>();
    collectionMeta.set("", hex("tezos-storage:content"));
    collectionMeta.set(
        "content",
        hex(
            JSON.stringify({
                name: process.env.ALEA_COLLECTION_NAME || "Aleatory Test Collection",
                description: "Deployed by contract/deploy-collection.ts",
                interfaces: ["TZIP-012", "TZIP-016"],
            }),
        ),
    );

    const factory = await tezos.contract.at(d.factory);

    // The provider's live quote, so the ceiling we pass is not a guess.
    const providerContract = await tezos.contract.at(d.provider);
    const renderGas = await providerContract.contractViews
        .get_render_gas()
        .executeView({ viewCaller: artist });

    console.log(`\nDeploy a collection`);
    console.log(`  factory       ${d.factory}`);
    console.log(`  provider      ${d.provider}  (render gas ${renderGas} mutez)`);
    console.log(`  artist        ${artist}`);
    console.log(`  code          ${codeUri}`);
    console.log(`  edition       ${editionSize === 0 ? "open" : editionSize}`);
    console.log(`  price         ${price} mutez`);
    console.log(`  royalties     ${royaltyBps} bps to ${artist}`);

    const params = {
        code_uri: codeUri,
        code_hash: codeHashHex,
        edition_size: editionSize,
        price,
        royalties,
        pending_metadata: hex(pending),
        start_paused: true, // deploy, check, announce, then open
        // Opt in explicitly. This extends metadata-write authority to whoever the
        // resolver vouches for, so it is a choice rather than a default.
        trust_resolver: process.env.ALEA_TRUST_RESOLVER === "true",
        provider: d.provider,
        max_render_gas: Number(renderGas),
        metadata: collectionMeta,
    };

    const est = await tezos.estimate.transfer(
        factory.methodsObject.deploy(params).toTransferParams(),
    );
    console.log(
        `\n  storage burn  ${(est.burnFeeMutez / 1_000_000).toFixed(6)} tez  (${est.storageLimit} bytes)`,
    );
    console.log(`  gas           ${est.gasLimit}`);
    console.log(
        `  total         ${(est.totalCost / 1_000_000).toFixed(6)} tez  <- what a collection costs an artist`,
    );

    if (DRY_RUN) {
        console.log("\nDRY RUN, nothing injected.");
        return;
    }

    const op = await factory.methodsObject.deploy(params).send();
    console.log(`\n  injected ${op.hash}, confirming...`);
    await op.confirmation();

    const storage = (await factory.storage()) as {
        collections: { get: (k: number) => Promise<string> };
        next_collection_id: { toNumber: () => number };
    };
    const id = storage.next_collection_id.toNumber() - 1;
    const address = await storage.collections.get(id);
    console.log(`  ✓ collection ${id}: ${address}`);
    console.log(`    https://${TZKT[NETWORK]}/${address}`);

    if (!DO_BUY) {
        console.log(`\nIt starts paused. Unpause with set_paused(false), then re-run with --buy.`);
        return;
    }

    const collection = await tezos.contract.at(address);
    console.log(`\nUnpausing and buying one piece...`);
    await (await collection.methodsObject.set_paused(false).send()).confirmation();

    const total = price + Number(renderGas);
    const buyEst = await tezos.estimate.transfer(
        collection.methodsObject.buy("").toTransferParams({ amount: total, mutez: true }),
    );
    console.log(
        `  mint storage burn  ${(buyEst.burnFeeMutez / 1_000_000).toFixed(6)} tez  (${buyEst.storageLimit} bytes)`,
    );
    console.log(`  mint gas           ${buyEst.gasLimit}`);
    console.log(`  paid on top of price + render gas  <- what a mint costs a collector`);

    const buyOp = await collection.methodsObject.buy("").send({ amount: total, mutez: true });
    console.log(`  injected ${buyOp.hash}, confirming...`);
    await buyOp.confirmation();
    console.log(`  ✓ token 0 minted. Its seed is this operation hash:`);
    console.log(`    ${buyOp.hash}`);
}

main().catch((e) => {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
});
