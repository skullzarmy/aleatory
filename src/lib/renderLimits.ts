/**
 * Generators whose live render is capped to a lower device pixel ratio, so a
 * visitor's browser stays responsive. Display only, additive to the one
 * already-present safeguard: a generator here still runs the real code, the
 * code itself is untouched, and the provider's own capture (the pinned image
 * every collector actually owns) is a separate render path this never
 * touches. Per network, same reasoning as blocklist.ts.
 */
import { NETWORK, type Network } from "./config";

/** `devicePixelRatio` a listed generator's live render is capped to. */
export const RENDER_LIMITED_MAX_DPR = 1;

const GENERATORS: Record<Network, readonly string[]> = {
    shadownet: [],
    mainnet: [
        // A particle count proportional to canvas area, uncapped by anything
        // but its own ceiling, drawn across a synchronous 180-step warm-up.
        // At device pixel ratio 2, the common case on modern hardware, the
        // warm-up is heavy enough to freeze the tab for several seconds.
        "KT1TUDEBX47K6jjfsnmQhovEsMe7NeTJihq4",
    ],
};

const RENDER_LIMITED: ReadonlySet<string> = new Set(GENERATORS[NETWORK]);

/** `RENDER_LIMITED_MAX_DPR` for a listed generator, `undefined` for every other one. */
export function maxDprFor(address: string): number | undefined {
    return RENDER_LIMITED.has(address) ? RENDER_LIMITED_MAX_DPR : undefined;
}
