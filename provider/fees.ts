/**
 * What an operation has to pay a baker to be taken.
 *
 * One rule, in one place, because it was worked out four times in this
 * repository and got a different answer each time.
 *
 * A baker's prefilter wants roughly `100 + 0.1 per gas unit + 1 per byte`, in
 * mutez. Two things about it are easy to get wrong and both have been:
 *
 * The gas term is charged against the limit the operation **declares**, not the
 * gas it goes on to use. A generous limit is not free. Taquito's own estimator
 * does not account for this either, so anything signing against this chain sets
 * its own fee rather than letting the library decide: an estimator's 2,069
 * mutez against a declared limit of 200,000 was refused, where the floor was
 * nearer 21,800.
 *
 * The byte term is the whole operation, not the parameter. Branch, source,
 * counter, the three limits, destination, entrypoint and a 64 byte signature
 * are none of them in the parameter and all of them charged.
 *
 * Failing this is silent in the worst way. The operation injects, the wallet
 * returns a hash, and it sits in the mempool as `fees_too_low` until it is
 * dropped. Nothing downstream can see that, so the only symptom is something
 * that never happens. Which is why this pays over the floor rather than at it:
 * the margin is a fraction of a millitez, and being under costs a publish, a
 * render, or an admin action nobody knows failed.
 */

/** Branch, source, counter, limits, destination, entrypoint, signature. */
export const ENVELOPE_BYTES = 512;

/** How far over the floor to pay. Under it is unrecoverable; over it is noise. */
const MARGIN = 1.1;

export function feeFor({ gas, bytes }: { gas: number; bytes: number }): number {
    return Math.ceil((100 + gas * 0.1 + bytes + ENVELOPE_BYTES) * MARGIN);
}
