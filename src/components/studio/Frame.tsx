"use client";

import { useMemo } from "react";
import { IsolateFrame } from "@/components/IsolateFrame";
import type { ParamSpec } from "@/lib/params";
import { resolveParams } from "@/lib/params";

/**
 * One rendered piece, from a draft on the artist's own disk. The draft never
 * leaves this browser: it goes to the isolate over postMessage, and the isolate
 * is a separate origin that executes and fetches nothing.
 *
 * The isolate owns the document builder and the harness, so the studio preview
 * and a minted piece run through the same code.
 */
export function Frame({
    html,
    seed,
    params,
    values,
    deps,
    className,
    onReady,
    onViolation,
    onError,
}: {
    html: string;
    seed: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    /** Library sources, already resolved, inlined ahead of the artist's code. */
    deps?: string[];
    className?: string;
    onReady?: () => void;
    onViolation?: (kind: string, detail: string) => void;
    onError?: (message: string) => void;
}) {
    // Resolved once per change, through the rule every reader shares. Resolving
    // inline would hand the frame a new object every render.
    const resolved = useMemo(() => resolveParams(params, values ?? {}), [params, values]);

    return (
        <IsolateFrame
            code={html}
            seed={seed}
            params={resolved}
            paramsSchema={params}
            deps={deps}
            liveClock
            className={className}
            title="Preview"
            onReady={() => onReady?.()}
            onViolation={onViolation}
            onError={onError}
        />
    );
}
