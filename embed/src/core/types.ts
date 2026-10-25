/**
 * Configuration options for the Aleatory execution harness.
 */
export interface HarnessOptions {
    /** The mint operation hash. */
    seed: string;
    /** Resolved parameter values. */
    params?: Record<string, unknown>;
    /** Declared parameter schema. */
    paramsSchema?: unknown[];
    /**
     * Let the clock run. Default is true for interactive viewing,
     * false for deterministic static capture.
     */
    liveClock?: boolean;
    /** Caps what devicePixelRatio reports inside the piece. */
    maxDpr?: number;
    /** Timeout in milliseconds before taking an automatic capture. */
    timeout?: number;
    /** Request serialized image data in the ready event. */
    wantImage?: boolean;
}

/**
 * Options for assembling a sandboxed generator document.
 */
export interface DocumentOptions extends HarnessOptions {
    /** The generator HTML source code. */
    code: string;
    /** Resolved library script contents, inlined in declared order. */
    deps?: string[];
}

/**
 * Payload emitted when a generator signals ready.
 */
export interface ReadyEventPayload {
    type: "alea:ready";
    seed: string;
    digest: string;
    image: string | null;
    source: "canvas" | "svg" | "none";
    features: Record<string, unknown>;
    violations: Array<{ kind: string; detail: string }>;
    mathRandomCalls: number;
    elapsed: number;
    autoCaptured: boolean;
}

/**
 * Payload emitted when a generator or CSP violation occurs.
 */
export interface ViolationEventPayload {
    type: "alea:violation";
    kind: string;
    detail: string;
}

/**
 * Payload emitted when an unhandled script error occurs inside the piece.
 */
export interface ErrorEventPayload {
    type: "alea:error";
    message: string;
    line: number | null;
}
