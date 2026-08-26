/**
 * Stand up a render provider.
 *
 *   npm run provider:setup            show what would happen, change nothing
 *   npm run provider:setup -- --go    do it
 *
 * Four steps, in this order, because each needs the one before it:
 *
 *   1. generate an agent key
 *   2. fund it from the operator wallet
 *   3. reveal it
 *   4. print the environment for the daemon
 *
 * Deploying the provider contract and listing it in the registry is
 * `contract/deploy.ts`, which the operator runs. This is the part that has to
 * happen once per agent and had no tooling, which is how a funded agent that
 * had never revealed ended up looking perfectly configured.
 */
import dotenv from "dotenv";
dotenv.config();

const { TezosToolkit } = await import("@taquito/taquito");
const { InMemorySigner } = await import("@taquito/signer");
const { b58cencode, prefix } = await import("@taquito/utils");
const crypto = await import("node:crypto");

const GO = process.argv.includes("--go");
const RPC = process.env.TEZOS_RPC || "https://rpc.tzkt.io/shadownet";

/**
 * What to send the agent.
 *
 * A reveal costs about 0.001 tez and a publish about 0.0015, so this is a few
 * thousand pieces. It holds nothing else on purpose: the agent is a hot key in
 * a serverless function, and what it is worth stealing should stay close to
 * the gas it needs.
 */
const FUND_TEZ = 5;

const operatorSk = process.env.TEZOS_WALLET_PRIV_KEY;
if (!operatorSk) {
    console.log("\nTEZOS_WALLET_PRIV_KEY is not set. That is the operator wallet, which");
    console.log("owns the provider contract and pays for this.\n");
    process.exit(1);
}

const tezos = new TezosToolkit(RPC);
const operator = await InMemorySigner.fromSecretKey(operatorSk);
tezos.setProvider({ signer: operator });
const operatorAddress = await operator.publicKeyHash();
const operatorBalance = (await tezos.tz.getBalance(operatorAddress)).toNumber() / 1e6;

console.log(`\nOperator  ${operatorAddress}  (${operatorBalance.toFixed(3)} tez)`);
if (operatorBalance < FUND_TEZ + 1) {
    console.log(`\nNot enough to fund an agent with ${FUND_TEZ} tez and cover the transfer.\n`);
    process.exit(1);
}

// Reuse an existing agent rather than stranding funds in one nobody records.
const existing = process.env.ALEA_AGENT_SK;
let agentSk: string;
if (existing) {
    agentSk = existing;
    console.log("Agent     reusing ALEA_AGENT_SK from the environment");
} else {
    agentSk = b58cencode(crypto.randomBytes(32), prefix.edsk2);
    console.log("Agent     generated a new key");
}

const agent = await InMemorySigner.fromSecretKey(agentSk);
const agentAddress = await agent.publicKeyHash();
const agentBalance = (await tezos.tz.getBalance(agentAddress)).toNumber() / 1e6;
const revealed = Boolean(await tezos.rpc.getManagerKey(agentAddress).catch(() => null));

console.log(`          ${agentAddress}  (${agentBalance.toFixed(3)} tez, ${revealed ? "revealed" : "not revealed"})`);

if (agentAddress === operatorAddress) {
    console.log("\nThe agent and the operator are the same address. The whole point of the");
    console.log("split is that a leaked agent key cannot touch the provider contract or");
    console.log("its balance, so the deploy refuses this.\n");
    process.exit(1);
}

const needsFunding = agentBalance < 0.5;
const needsReveal = !revealed;

console.log("\nTo do");
console.log(`  ${needsFunding ? "send" : "skip"}    fund the agent with ${FUND_TEZ} tez`);
console.log(`  ${needsReveal ? "send" : "skip"}    reveal the agent's key`);

if (!GO) {
    console.log("\nNothing sent. Re-run with --go.\n");
    if (!existing) {
        console.log("The generated key is not saved anywhere. A real run prints it.\n");
    }
    process.exit(0);
}

if (needsFunding) {
    console.log(`\nFunding ${agentAddress}…`);
    const op = await tezos.contract.transfer({ to: agentAddress, amount: FUND_TEZ });
    await op.confirmation();
    console.log(`  ${op.hash}`);
}

if (needsReveal) {
    // Sent by hand, never bundled with the agent's first real operation. On
    // this chain `hard_gas_limit_per_operation` equals the per-block limit,
    // so a reveal riding along overflows and the batch is refused. The symptom
    // is an agent that is funded, looks fine, and lands nothing.
    console.log(`\nRevealing ${agentAddress}…`);
    const t = new TezosToolkit(RPC);
    t.setProvider({ signer: agent });
    const branch = (await t.rpc.getBlockHeader()).hash;
    const protocol = (await t.rpc.getProtocols()).protocol;
    const counter = parseInt((await t.rpc.getContract(agentAddress)).counter ?? "0", 10);
    const contents = [
        {
            kind: "reveal",
            source: agentAddress,
            fee: "1000",
            counter: String(counter + 1),
            gas_limit: "5000",
            storage_limit: "0",
            public_key: await agent.publicKey(),
        },
    ];
    const forged = await t.rpc.forgeOperations({ branch, contents } as never);
    const sig = await agent.sign(forged, new Uint8Array([3]));
    await t.rpc.preapplyOperations([
        { branch, contents, protocol, signature: sig.prefixSig },
    ] as never);
    const hash = await t.rpc.injectOperation(sig.sbytes);
    console.log(`  ${hash}, waiting…`);

    let ok = false;
    for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        if (await t.rpc.getManagerKey(agentAddress).catch(() => null)) {
            ok = true;
            break;
        }
    }
    if (!ok) {
        console.log("\n  Not confirmed. Check the operation before running this again.\n");
        process.exit(1);
    }
    console.log("  revealed");
}

console.log("\nThe agent is ready. Put this in .env, and nowhere a browser can read it:\n");
console.log(`ALEA_AGENT_ADDRESS=${agentAddress}`);
console.log(`ALEA_AGENT_SK=${agentSk}`);
console.log("\nIt signs set_token_metadata and nothing else. It cannot pause a");
console.log("collection, move a token, change a price, or touch the provider");
console.log("contract's balance. Losing it costs you the gas in it and nothing more.");
console.log("Top it up when it runs low; a publish costs about 0.0015 tez.\n");
