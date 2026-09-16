/**
 * What an operation has to pay a baker to be taken.
 *
 * A copy of `provider/fees.ts`, because this console builds on its own and
 * shares no module with the app, the way `landing/` does. If the rule changes
 * there it has to change here, and the reason it is worth the duplication is
 * that getting it wrong is silent: the operation injects, the wallet returns a
 * hash, and it sits in the mempool as `fees_too_low` until it is dropped, so an
 * admin action simply never happens and nothing says so.
 *
 * The gas term is charged against the limit declared, not the gas used, and the
 * byte term covers the whole operation rather than the parameter: branch,
 * source, counter, limits, destination, entrypoint and a 64 byte signature.
 */

/** Branch, source, counter, limits, destination, entrypoint, signature. */
export const ENVELOPE_BYTES = 512;

/** How far over the floor to pay. Under it is unrecoverable; over it is noise. */
const MARGIN = 1.1;

export function feeFor({ gas, bytes }: { gas: number; bytes: number }): number {
    return Math.ceil((100 + gas * 0.1 + bytes + ENVELOPE_BYTES) * MARGIN);
}
