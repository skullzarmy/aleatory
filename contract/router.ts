/**
 * Point the router at a contract.
 *
 *   npm run router -- --network shadownet add-factory KT1…
 *   npm run router -- --network shadownet --dry-run add-factory KT1…
 *   npm run router -- --network shadownet show
 *
 * Changing the collection template means a new factory, and a new factory is
 * useless until the router names it. `deploy.ts` originates contracts and
 * stops there, so that last step was being done by hand against the RPC,
 * which is how a mainnet router gets pointed at a shadownet factory.
 *
 * Reads the chain's own id and refuses if it disagrees with `--network`. The
 * environment carries both networks in one file with one of them commented
 * out, so the declared network and the configured one come apart easily, and
 * nothing on chain catches it afterwards.
 */
import { TezosToolkit } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { feeFor } from "../provider/fees";

const __dirname = dirname(fileURLToPath(import.meta.url));

const arg = (name: string) => process.argv.find((_a, i) => process.argv[i - 1] === name);

const NETWORK = arg("--network") || process.env.TEZOS_NETWORK || "shadownet";
const DRY_RUN = process.argv.includes("--dry-run");

const NETWORKS = {
    shadownet: { chainId: "NetXsqzbfFenSTS", rpc: "https://rpc.tzkt.io/shadownet" },
    mainnet: { chainId: "NetXdQprcVkpaWU", rpc: "https://rpc.tzkt.io/mainnet" },
} as const;

/** Each one takes a single address, and only the administrator may call it. */
const ACTIONS = {
    "add-factory": "add_factory",
    "set-marketplace": "set_marketplace",
    "set-registry": "set_registry",
    "set-resolver": "set_resolver",
} as const;

type Action = keyof typeof ACTIONS;

const KT1 = /^KT1[1-9A-HJ-NP-Za-km-z]{33}$/;

function die(why: string): never {
    console.error(`\n✗ ${why}`);
    process.exit(1);
}

async function main() {
    if (!(NETWORK in NETWORKS)) die(`Unknown --network "${NETWORK}".`);
    const net = NETWORKS[NETWORK as keyof typeof NETWORKS];

    // The same guard `deploy.ts` makes, for the same reason: a run against the
    // other network's environment writes the wrong address permanently.
    const envNetwork = process.env.PUBLIC_TEZOS_NETWORK;
    if (envNetwork && envNetwork !== NETWORK) {
        die(`REFUSING: --network ${NETWORK} but PUBLIC_TEZOS_NETWORK=${envNetwork}.`);
    }

    const router = JSON.parse(
        readFileSync(resolve(__dirname, "deployments", `${NETWORK}.json`), "utf8"),
    ).router as string;
    if (!KT1.test(router ?? "")) die(`No router recorded for ${NETWORK}.`);

    const rpc = process.env.TEZOS_RPC || net.rpc;
    const tezos = new TezosToolkit(rpc);

    // The chain, asked rather than assumed. Everything above is configuration,
    // and configuration is what gets this wrong.
    const chainId = await tezos.rpc.getChainId();
    if (chainId !== net.chainId) {
        die(`REFUSING: ${rpc} is chain ${chainId}, not ${NETWORK} (${net.chainId}).`);
    }

    const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const skip = new Set([NETWORK, rpc]);
    const [verb, target] = positional.filter((a) => !skip.has(a));

    console.log(`\nRouter ${router}`);
    console.log(`  network   ${NETWORK}  (${rpc}, ${chainId})`);

    // Through the contract, not `rpc.getStorage`, which answers in raw
    // Micheline and reads as a record of undefined.
    const contract = await tezos.contract.at(router);
    const storage = (await contract.storage()) as {
        factories?: string[];
        marketplace?: string;
        registry?: string;
        resolver?: string;
        administrator?: string;
    };

    if (!verb || verb === "show") {
        console.log(`  admin     ${storage.administrator}`);
        console.log(`  factory   ${storage.factories?.[0]}  (head, where new deploys go)`);
        console.log(`  retired   ${(storage.factories ?? []).slice(1).join(", ") || "none"}`);
        console.log(`  market    ${storage.marketplace}`);
        console.log(`  registry  ${storage.registry}`);
        console.log(`  resolver  ${storage.resolver}`);
        if (!verb) console.log(`\n  Actions: ${Object.keys(ACTIONS).join(", ")}, show`);
        return;
    }

    if (!(verb in ACTIONS))
        die(`Unknown action "${verb}". One of: ${Object.keys(ACTIONS).join(", ")}, show`);
    if (!KT1.test(target ?? "")) die(`"${target ?? ""}" is not a KT1 address.`);

    const entrypoint = ACTIONS[verb as Action];
    const secretKey = process.env.TEZOS_WALLET_PRIV_KEY;
    if (!secretKey) die("TEZOS_WALLET_PRIV_KEY is not set.");
    const signer = await InMemorySigner.fromSecretKey(secretKey);
    tezos.setSignerProvider(signer);
    const sender = await signer.publicKeyHash();

    console.log(`  signer    ${sender}`);
    console.log(`  calling   ${entrypoint}(${target})`);

    // Said before the wallet is touched. The contract refuses it too, and its
    // refusal costs a signature and a fee.
    if (storage.administrator && sender !== storage.administrator) {
        die(
            `REFUSING: ${entrypoint} is administrator-only, and the router's admin is ${storage.administrator}.`,
        );
    }
    if (verb === "add-factory" && (storage.factories ?? []).includes(target)) {
        die(`${target} is already listed. add_factory prepends, so this would list it twice.`);
    }

    const params = contract.methodsObject[entrypoint](target).toTransferParams();
    const est = await tezos.estimate.transfer(params);
    console.log(`  estimate  gas ${est.gasLimit}, burn ${est.burnFeeMutez} mutez`);

    if (DRY_RUN) {
        console.log(`\n  DRY RUN, nothing injected`);
        return;
    }

    // An estimated fee is refused on this chain, silently, so the floor is
    // declared. Same rule every other operation here follows.
    const op = await contract.methodsObject[entrypoint](target).send({
        fee: feeFor({ gas: est.gasLimit, bytes: est.opSize ?? 0 }),
        gasLimit: est.gasLimit,
        storageLimit: est.storageLimit,
    });
    console.log(`  injected  ${op.hash}, confirming...`);
    await op.confirmation(1);

    const after = (await contract.storage()) as { factories?: string[] };
    console.log(`  ✓ ${verb === "add-factory" ? `head factory ${after.factories?.[0]}` : "done"}`);
}

void main();
