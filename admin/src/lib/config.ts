// This file deploys separately from the public site's config, so an operator
// can point the admin console at a different network than the public site.

export type Network = "shadownet" | "mainnet";

export const NETWORK: Network = (process.env.NEXT_PUBLIC_TEZOS_NETWORK as Network) || "shadownet";

export const RPC_URL: Record<Network, string> = {
    shadownet: "https://rpc.tzkt.io/shadownet",
    mainnet: "https://rpc.tzkt.io/mainnet",
};

export const TZKT_API: Record<Network, string> = {
    shadownet: "https://api.shadownet.tzkt.io",
    mainnet: "https://api.tzkt.io",
};

export const TZKT_WEB: Record<Network, string> = {
    shadownet: "https://shadownet.tzkt.io",
    mainnet: "https://tzkt.io",
};

export function rpcUrl(): string {
    return RPC_URL[NETWORK];
}

export function tzktApi(): string {
    return TZKT_API[NETWORK];
}

export function tzktLink(hashOrAddress: string): string {
    return `${TZKT_WEB[NETWORK]}/${hashOrAddress}`;
}

// The public site lists all providers; `provider` here is the one this
// operator runs and administers.
export const ADDRESSES = {
    router: process.env.NEXT_PUBLIC_ROUTER_ADDRESS || "",
    factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "",
    marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "",
    registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || "",
    resolver: process.env.NEXT_PUBLIC_RESOLVER_ADDRESS || "",
    provider: process.env.NEXT_PUBLIC_PROVIDER_ADDRESS || "",
    agent: process.env.NEXT_PUBLIC_AGENT_ADDRESS || "",
} as const;

export type AddressKey = keyof typeof ADDRESSES;

// Below this, top the daemon up. An empty agent key fails silently: publishing
// stops and pieces sit pending, which looks like a render fault.
export const AGENT_LOW_WATER_MUTEZ = Number(
    process.env.NEXT_PUBLIC_AGENT_LOW_WATER_MUTEZ || 5_000_000,
);

export const BRAND = {
    name: "Aleatory Admin",
    description: "Operator console for the Aleatory marketplace and render provider.",
};
