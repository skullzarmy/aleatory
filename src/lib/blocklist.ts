/**
 * What this site declines to show. Display only: the contracts gate nothing,
 * and a fork that disagrees drops this list.
 *
 * Per network, because most of what lands here is testing debris, and one
 * shared list would ship every dead shadownet experiment to mainnet.
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
