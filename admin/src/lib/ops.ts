import type { DAppClient } from "@tezos-x/octez.connect-sdk";
import { rpcUrl } from "./config";

/**
 * Every privileged action, described once and sent two ways.
 *
 * Control of these contracts is meant to end up with a multisig, and a KT1
 * cannot hold a Beacon session, so it has to be handed the operation and vote
 * on it. Nothing here sends anything: an action builds an `AdminOp` describing
 * one call, and a sink decides what happens to it. `signNow` puts it through
 * the connected wallet, `toProposal` hands it over as data.
 *
 * Every op states its authority, so the console can refuse before a signature
 * rather than after a failed operation somebody paid for.
 */

/** Who the chain will accept this call from. */
export type Authority =
    /** Destination is fixed in storage, so there is nothing to steal. */
    | "anyone"
    /** The contract's `administrator`. */
    | "admin"
    /** The provider's `operator`. */
    | "operator"
    /** The address a pending `propose_admin` named, and only that address. */
    | "proposed";

export interface AdminOp {
    /** What this does, as a sentence, for the confirm step and the audit log. */
    label: string;
    /** The contract being called. */
    to: string;
    entrypoint: string;
    /**
     * Named fields for a record, the value itself for a single argument,
     * `null` for an entrypoint taking unit. Taquito rejects a one-element
     * array where it wants a scalar, which is a runtime error and not a type
     * error, so the shape has to match the entrypoint exactly.
     */
    args: unknown;
    authority: Authority;
    /** Mutez to attach. Always zero: every entrypoint asserts `TEZ_NOT_ACCEPTED`. */
    amount?: number;
}

export interface OpResult {
    hash: string;
}

/**
 * Michelson for one call, by field name through Taquito's `methodsObject`.
 * SmartPy lays a record's fields out alphabetically, so a positional encoding
 * of `withdraw(amount, to_)` is right only by luck.
 */
export async function encode(
    op: AdminOp,
): Promise<{ entrypoint: string; value: unknown }> {
    const { TezosToolkit } = await import("@taquito/taquito");
    const contract = await new TezosToolkit(rpcUrl()).contract.at(op.to);
    const methods = contract.methodsObject as unknown as Record<
        string,
        (a: unknown) => {
            toTransferParams: () => {
                parameter?: { entrypoint: string; value: unknown };
            };
        }
    >;
    const method = methods[op.entrypoint];
    if (!method) {
        throw new Error(`${op.to} has no entrypoint ${op.entrypoint}.`);
    }
    const parameter = method(op.args).toTransferParams().parameter;
    if (!parameter) throw new Error(`${op.entrypoint} encoded to nothing.`);
    return parameter;
}

/** A baker's floor: ~100 + 0.1 per gas unit + 1 per byte, in mutez. */
const GAS = 100_000;
const STORAGE = 1_000;
const FEE = 100 + Math.ceil(GAS * 0.1) + 500;

/** Sink one: through the wallet in this browser, now. */
export async function signNow(client: DAppClient, op: AdminOp): Promise<OpResult> {
    const parameter = await encode(op);
    const result = await client.requestOperation({
        operationDetails: [
            {
                kind: "transaction",
                destination: op.to,
                amount: String(op.amount ?? 0),
                parameters: { entrypoint: parameter.entrypoint, value: parameter.value },
                fee: String(FEE),
                gas_limit: String(GAS),
                storage_limit: String(STORAGE),
            } as never,
        ],
    });
    return { hash: (result as { transactionHash: string }).transactionHash };
}

/**
 * Sink two: the same call as data, for something else to submit. In no
 * particular multisig's proposal format, since every one wants these same
 * facts. The label rides along so the people voting need not read Michelson.
 */
export async function toProposal(op: AdminOp): Promise<string> {
    const parameter = await encode(op);
    return JSON.stringify(
        {
            description: op.label,
            requires: op.authority,
            to: op.to,
            amount_mutez: op.amount ?? 0,
            entrypoint: parameter.entrypoint,
            parameters: parameter.value,
        },
        null,
        2,
    );
}

// Every op below takes the contract to act on. The console resolves addresses
// from the router, so reading one from configuration would let a button act on
// a different contract from the one whose state is on screen.

// Marketplace

export const withdrawMarketplaceFees = (marketplace: string): AdminOp => ({
    label: "Sweep accrued marketplace fees to the treasury",
    to: marketplace,
    entrypoint: "withdraw_fees",
    args: null,
    authority: "anyone",
});

export const setFee = (marketplace: string, feeBps: number): AdminOp => ({
    label: `Set the marketplace fee to ${(feeBps / 100).toFixed(2)}%`,
    to: marketplace,
    entrypoint: "set_fee",
    args: feeBps,
    authority: "admin",
});

export const setMarketplaceTreasury = (marketplace: string, treasury: string): AdminOp => ({
    label: `Send marketplace fees to ${treasury}`,
    to: marketplace,
    entrypoint: "set_treasury",
    args: treasury,
    authority: "admin",
});

export const setMarketplacePaused = (marketplace: string, paused: boolean): AdminOp => ({
    label: paused
        ? "Pause the marketplace: no new listings, offers or purchases"
        : "Resume the marketplace",
    to: marketplace,
    entrypoint: "set_paused",
    args: paused,
    authority: "admin",
});

// Factory

export const withdrawFactoryFees = (factory: string): AdminOp => ({
    label: "Sweep accrued deploy fees to the treasury",
    to: factory,
    entrypoint: "withdraw_fees",
    args: null,
    authority: "anyone",
});

export const setFactoryTreasury = (factory: string, treasury: string): AdminOp => ({
    label: `Send deploy fees to ${treasury}`,
    to: factory,
    entrypoint: "set_treasury",
    args: treasury,
    authority: "admin",
});

export const setFactoryPaused = (factory: string, paused: boolean): AdminOp => ({
    label: paused
        ? "Pause the factory: no new generators can be deployed"
        : "Resume the factory",
    to: factory,
    entrypoint: "set_paused",
    args: paused,
    authority: "admin",
});

export const setDeployPrice = (factory: string, mutez: number): AdminOp => ({
    label: `Charge ${mutez} mutez to deploy a generator`,
    to: factory,
    entrypoint: "set_deploy_price",
    args: mutez,
    authority: "admin",
});

export const setFactoryResolver = (factory: string, resolver: string): AdminOp => ({
    label: `Point the factory at resolver ${resolver}`,
    to: factory,
    entrypoint: "set_resolver",
    args: resolver,
    authority: "admin",
});

// Registry

export const registerProvider = (registry: string, provider: string): AdminOp => ({
    label: `List ${provider} in the provider registry`,
    to: registry,
    entrypoint: "register",
    args: provider,
    // The registry asks the provider contract for the views that define one, so
    // a bad entry cannot land. A type check, and it needs nobody's permission.
    authority: "anyone",
});

export const deregisterProvider = (registry: string, provider: string): AdminOp => ({
    label: `Remove ${provider} from the provider registry`,
    to: registry,
    entrypoint: "deregister",
    args: provider,
    // Checked by asking the provider contract itself who its operator is.
    authority: "operator",
});

// Provider

export const setRenderGas = (provider: string, mutez: number): AdminOp => ({
    label: `Charge ${mutez} mutez of render gas per mint`,
    to: provider,
    entrypoint: "set_render_gas",
    args: mutez,
    authority: "operator",
});

export const withdrawRenderGas = (
    provider: string,
    mutez: number,
    to: string,
): AdminOp => ({
    label: `Withdraw ${mutez} mutez of render gas to ${to}`,
    to: provider,
    entrypoint: "withdraw",
    args: { amount: mutez, to_: to },
    authority: "operator",
});

export const setAgent = (provider: string, agent: string): AdminOp => ({
    label: `Rotate the render agent key to ${agent}`,
    to: provider,
    entrypoint: "set_agent",
    args: agent,
    authority: "operator",
});

export const setProviderMetadata = (
    provider: string,
    key: string,
    value: string,
): AdminOp => ({
    label: `Set provider metadata ${key || "(empty key)"}`,
    to: provider,
    entrypoint: "set_metadata",
    // The contract stores bytes, and TZIP-16 keeps a URI here.
    args: { key, value: toHex(value) },
    authority: "operator",
});

/** UTF-8 to the hex string Taquito expects for a `bytes` field. */
export function toHex(text: string): string {
    return Array.from(new TextEncoder().encode(text))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

// Router

export const addFactory = (router: string, factory: string): AdminOp => ({
    label: `Point new deploys at factory ${factory}`,
    to: router,
    entrypoint: "add_factory",
    args: factory,
    authority: "admin",
});

export const setRouterMarketplace = (router: string, marketplace: string): AdminOp => ({
    label: `Point the platform at marketplace ${marketplace}`,
    to: router,
    entrypoint: "set_marketplace",
    args: marketplace,
    authority: "admin",
});

export const setRouterRegistry = (router: string, registry: string): AdminOp => ({
    label: `Point the platform at registry ${registry}`,
    to: router,
    entrypoint: "set_registry",
    args: registry,
    authority: "admin",
});

export const setRouterResolver = (router: string, resolver: string): AdminOp => ({
    label: `Point the platform at resolver ${resolver}`,
    to: router,
    entrypoint: "set_resolver",
    args: resolver,
    authority: "admin",
});

// Resolver. `writers` is the second half of revoking a leaked daemon key:
// `set_agent` stops it writing token media, this stops it writing resolution.

export const addWriter = (resolver: string, writer: string): AdminOp => ({
    label: `Allow ${writer} to write resolver entries`,
    to: resolver,
    entrypoint: "add_writer",
    args: writer,
    authority: "admin",
});

export const removeWriter = (resolver: string, writer: string): AdminOp => ({
    label: `Revoke ${writer} from writing resolver entries`,
    to: resolver,
    entrypoint: "remove_writer",
    args: writer,
    authority: "admin",
});

// Handing over control, in two steps on every contract with an administrator,
// so a typo cannot strand it: the new administrator has to appear and accept.

export const proposeAdmin = (contract: string, newAdmin: string): AdminOp => ({
    label: `Offer administration of ${contract} to ${newAdmin}`,
    to: contract,
    entrypoint: "propose_admin",
    args: newAdmin,
    authority: "admin",
});

export const acceptAdmin = (contract: string): AdminOp => ({
    label: `Accept administration of ${contract}`,
    to: contract,
    entrypoint: "accept_admin",
    args: null,
    authority: "proposed",
});

/**
 * Setters by name, for the controls that take typed input. A server component
 * cannot hand a client component a function, so the page names the setter and
 * the control looks it up.
 */
export const SETTERS = {
    fee: (to, v) => setFee(to, Number(v)),
    marketplaceTreasury: (to, v) => setMarketplaceTreasury(to, String(v)),
    factoryTreasury: (to, v) => setFactoryTreasury(to, String(v)),
    deployPrice: (to, v) => setDeployPrice(to, Number(v)),
    factoryResolver: (to, v) => setFactoryResolver(to, String(v)),
    routerMarketplace: (to, v) => setRouterMarketplace(to, String(v)),
    routerRegistry: (to, v) => setRouterRegistry(to, String(v)),
    routerResolver: (to, v) => setRouterResolver(to, String(v)),
    addFactory: (to, v) => addFactory(to, String(v)),
    addWriter: (to, v) => addWriter(to, String(v)),
} satisfies Record<string, (to: string, value: string | number) => AdminOp>;

export type SetterKey = keyof typeof SETTERS;
