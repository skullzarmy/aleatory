/**
 * Every brand string and every chain address, in one module, so a fork, a
 * rename, or a redeploy is a one-file change (roadmap.md §4). Nothing else in
 * the app hardcodes a name, a domain, or a KT1.
 */

export const BRAND = {
    name: "Aleatory",
    tagline: "Fully on-chain generative art on Tezos",
    description:
        "A generator is code, published once and immutable. A piece is that code plus a seed bound to the operation that bought it.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://aleatory.art",
    repo: "https://github.com/skullzarmy/aleatory",
} as const;

export type Network = "shadownet" | "mainnet";

export const NETWORK: Network =
    (process.env.NEXT_PUBLIC_TEZOS_NETWORK as Network) || "shadownet";

export const TZKT_API: Record<Network, string> = {
    shadownet: "https://api.shadownet.tzkt.io",
    mainnet: "https://api.tzkt.io",
};

export const TZKT_UI: Record<Network, string> = {
    shadownet: "https://shadownet.tzkt.io",
    mainnet: "https://tzkt.io",
};

/** The node reads go through: protocol constants, contract types, estimation. */
export const RPC: Record<Network, string> = {
    shadownet: "https://rpc.tzkt.io/shadownet",
    mainnet: "https://rpc.tzkt.io/mainnet",
};

export const rpcUrl = () => RPC[NETWORK];

/**
 * Contract addresses, written by contract/deploy.ts into
 * contract/deployments/<network>.json and copied into the environment.
 *
 * Empty until something is deployed. The UI reads empty as "nothing deployed
 * yet" and says so.
 */
export const CONTRACTS = {
    factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "",
    marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "",
    registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || "",
    resolver: process.env.NEXT_PUBLIC_RESOLVER_ADDRESS || "",
} as const;

/**
 * Artist code renders here, never on this origin.
 *
 * Generator JavaScript is untrusted and runs in every visitor's browser. Same
 * origin would give it reach into wallet state and session storage, so
 * artifacts are framed from a separate host. See docs/architecture.md §10.
 */
export const ISOLATE_ORIGIN =
    process.env.NEXT_PUBLIC_ISOLATE_ORIGIN || "https://isolate.aleatory.art";

export const tzktApi = () => TZKT_API[NETWORK];
export const tzktLink = (hashOrAddress: string) =>
    `${TZKT_UI[NETWORK]}/${hashOrAddress}`;
