/**
 * What this site declines to show.
 *
 * Display only. The contracts gate nothing: anyone can deploy a collection,
 * run a provider, list on the marketplace, or run the whole system without
 * asking. This list is one front end's editorial choice, it lives in the
 * open, and a fork that disagrees drops it.
 *
 * Kept per network, because most of what lands here is testing debris. One
 * shared list means every dead shadownet experiment ships to mainnet forever,
 * where it can only confuse whoever reads it next.
 */
import { NETWORK, type Network } from "./config";

const COLLECTIONS: Record<Network, readonly string[]> = {
    shadownet: [
        // Deployed during testing with a generator that had a syntax error, so
        // it renders as an empty square and always will: the code is immutable.
        "KT1Q9PqMtkiwFxhofbb2mAbP1UFoLYaHsg2s",
    ],
    mainnet: [],
};

const PROVIDERS: Record<Network, readonly string[]> = {
    shadownet: [],
    mainnet: [],
};

/** Collections hidden from feeds, market rows and collection lists. */
export const BLOCKED_COLLECTIONS: ReadonlySet<string> = new Set(COLLECTIONS[NETWORK]);

/** Providers hidden from the picker and the providers page. */
export const BLOCKED_PROVIDERS: ReadonlySet<string> = new Set(PROVIDERS[NETWORK]);

export function isBlockedCollection(address: string): boolean {
    return BLOCKED_COLLECTIONS.has(address);
}

export function isBlockedProvider(address: string): boolean {
    return BLOCKED_PROVIDERS.has(address);
}
