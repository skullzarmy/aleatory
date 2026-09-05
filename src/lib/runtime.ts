/**
 * The message shapes the runtime harness speaks.
 *
 * The harness itself lives in `isolate/index.html` and in
 * `provider/render.mts`. The two agree by conforming to ALEATORY-001 §7, not by
 * sharing a file, and a third copy here would be a third thing to drift.
 *
 * What the harness provides: a seeded PRNG, the $alea lifecycle (boot / render
 * / ready / features / resize), blocked and reported network access, a
 * substituted Math.random, and a digested capture at the declared capture
 * point.
 */

/**
 * Bumped when the harness changes behaviour. Recorded on chain per generator as
 * `standard_version`, so a piece boots the harness it was made for.
 *
 * v2 adds declared mint-time parameters: `$alea.params` is populated from the
 * generator's schema, `$alea.paramsSchema` exposes the declaration, and a read
 * of an undeclared name is reported. v1 code declared nothing and so receives
 * nothing. One harness serves both today; archiving a harness per (kind,
 * standard_version) is v1 work (architecture §3).
 */
export const STANDARD_VERSION = 2;

/** Messages posted from the frame to the lab. */
export type FrameMessage =
    | { type: "alea:boot"; seed: string }
    | {
          type: "alea:ready";
          seed: string;
          /** sha-256 (or fallback) of the captured output, the determinism digest. */
          digest: string;
          /** data: URL of the capture, only when requested. */
          image: string | null;
          /** What the capture came from. */
          source: "canvas" | "svg" | "none";
          features: Record<string, string | number | boolean>;
          violations: Violation[];
          /**
           * How many times the piece reached for Math.random. Not a violation:
           * the seeded stream is substituted, and libraries call it too (p5
           * does, during init). A likely cause when two runs of one seed differ.
           */
          mathRandomCalls: number;
          /** ms from boot to ready(). */
          elapsed: number;
          /** true when ready() never fired and we captured on the timeout. */
          autoCaptured: boolean;
      }
    | { type: "alea:violation"; violation: Violation }
    | { type: "alea:error"; message: string }
    | { type: "alea:params-declared"; params: unknown[] };

export interface Violation {
    kind: "network" | "capture" | "runtime";
    detail: string;
}

export interface HarnessConfig {
    /** 64 hex chars, the seed. */
    seed: string;
    /**
     * The mint-time parameter values, already resolved against the schema by
     * `resolveParams`. The harness clamps nothing, so resolution stays one rule
     * in one place.
     */
    params: Record<string, unknown>;
    /** The declaration the values were resolved against. Empty when none. */
    paramsSchema?: ParamDeclaration[];
    /** Return the capture image, not just its digest. */
    wantImage: boolean;
    /** ms after load before we give up waiting for ready() and capture anyway. */
    timeout: number;
}

/** The subset of a ParamSpec the frame needs. Typed loosely so this file stays
 *  importable by frame-side tooling that knows nothing about the studio. */
export interface ParamDeclaration {
    id: string;
    label: string;
    type: string;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    default: number | boolean | string;
    hint?: string;
}

