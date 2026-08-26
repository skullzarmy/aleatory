/**
 * Aleatory, the runtime harness.
 *
 * This is the code that boots inside the frame, before the artist's
 * code, and provides the whole contract described in docs/aleatory:
 *
 *   - a seeded PRNG, so the piece is a pure function of (code, seed, params)
 *   - the $alea lifecycle: boot / render / ready / features / resize
 *   - mechanical enforcement of the determinism rule: network access is
 *     blocked and reported, Math.random is substituted and reported
 *   - deterministic capture at the declared capture point, digested so two
 *     runs of the same seed can be compared
 *
 * The types below describe the messages the isolate posts back.
 * sandboxed srcdoc frame with an opaque origin, nothing here can be imported
 * by the frame, so everything the frame needs travels with it.
 */

/**
 * Bumped when the harness changes behaviour. Recorded on chain per generator
 * as `standard_version`, so a piece always boots the harness it was made for.
 *
 * v2 adds declared mint-time parameters: `$alea.params` is populated from the
 * generator's schema, `$alea.paramsSchema` exposes the declaration to the piece,
 * and a read of an undeclared name is reported. v1 code is unaffected, it
 * declared nothing, so it receives nothing, and every v1 entry point still
 * means exactly what it meant. Serving one harness for both is the v0 shortcut;
 * archiving a harness per (kind, standard_version) is v1 work (architecture §3).
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
           * the seeded stream is substituted, so the run stays reproducible, and
           * libraries call it too (p5 does, during init). Reported only where it
           * is actionable, as a likely cause when two runs of one seed differ.
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
     * The mint-time parameter values, ALREADY resolved against the schema by
     * params.resolveParams. The harness clamps nothing: resolution is one rule
     * in one place, shared by every caller, or it is two rules that disagree.
     */
    params: Record<string, unknown>;
    /** The declaration the values were resolved against. Empty when none. */
    paramsSchema?: ParamDeclaration[];
    /** Return the capture image, not just its digest. */
    wantImage: boolean;
    /** ms after load before we give up waiting for ready() and capture anyway. */
    timeout: number;
}

/** The subset of a ParamSpec the frame needs. Structurally a ParamSpec; typed
 *  loosely here so runtime.ts stays importable by anything, including the
 *  frame-side tooling that has no business knowing about the studio. */
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

/**
 * The harness source. `__GX_CONFIG__` is replaced with a JSON literal by
 * buildSandboxDoc. Written as ES5-flavoured JS on purpose: it runs before
 * anything else in a frame we do not control, and it should never be the
 * reason a piece fails to boot.
 */
/**
 * The harness itself lives in `isolate/index.html`, not here.
 *
 * The app used to ship a third copy of it, and that copy drifted: it seeded
 * its PRNG by parsing a base58 operation hash as hex, so the studio drew a
 * different picture from the one that went on chain. There are two
 * implementations now, the isolate and `worker/render.ts`, and they agree by
 * conforming to ALEATORY-001 §7 rather than by sharing a file.
 *
 * What stays here are the message shapes both sides speak.
 */
