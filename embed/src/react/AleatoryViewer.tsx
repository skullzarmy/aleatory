import React, { useEffect, useRef, useState, useMemo } from "react";
import type { ErrorEventPayload, ReadyEventPayload, ViolationEventPayload } from "../core/types.js";
import { parseLibraries } from "../libraries/parser.js";
import { resolveLibraries } from "../libraries/resolver.js";
import { createSandbox, type SandboxController } from "../viewer/sandbox.js";

export interface AleatoryViewerProps {
    /** The generator HTML source. */
    code: string;
    /** The mint operation hash. */
    seed: string;
    /** Parameter values chosen by minter or collector. */
    params?: Record<string, unknown>;
    /** Declared parameter schema. */
    paramsSchema?: unknown[];
    /** Pre-resolved library scripts. If omitted, they are automatically resolved from CDN. */
    deps?: string[];
    /** Let the clock run. Default true. Set false for deterministic static capture. */
    liveClock?: boolean;
    /** Caps what devicePixelRatio reports inside the piece. */
    maxDpr?: number;
    /** Request image data URL in the ready event. */
    wantImage?: boolean;
    /** Optional class name for the wrapper element. */
    className?: string;
    /** Optional CSS styles for the wrapper element. */
    style?: React.CSSProperties;
    /** Fired when the piece signals ready. */
    onReady?: (payload: ReadyEventPayload) => void;
    /** Fired on generator script errors. */
    onError?: (payload: ErrorEventPayload) => void;
    /** Fired on network or CSP violations. */
    onViolation?: (payload: ViolationEventPayload) => void;
}

/**
 * React component for embedding and running Aleatory generative artworks.
 */
export function AleatoryViewer({
    code,
    seed,
    params,
    paramsSchema,
    deps: explicitDeps,
    liveClock = true,
    maxDpr,
    wantImage = false,
    className,
    style,
    onReady,
    onError,
    onViolation,
}: AleatoryViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<SandboxController | null>(null);

    const [resolvedDeps, setResolvedDeps] = useState<string[] | null>(explicitDeps ?? null);
    const [libError, setLibError] = useState<string | null>(null);

    // Track libraries declared in the code
    const declaredLibrariesKey = useMemo(() => {
        if (explicitDeps) return "";
        const { specs } = parseLibraries(code);
        return specs.map((s) => `${s.id}@${s.version}/${s.path}#${s.hash || ""}`).join(",");
    }, [code, explicitDeps]);

    useEffect(() => {
        if (explicitDeps) {
            setResolvedDeps(explicitDeps);
            return;
        }

        const { specs } = parseLibraries(code);
        if (specs.length === 0) {
            setResolvedDeps([]);
            return;
        }

        let cancelled = false;
        resolveLibraries(specs)
            .then((res) => {
                if (cancelled) return;
                setResolvedDeps(res.map((r) => r.source));
                setLibError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : String(err);
                setLibError(msg);
                onError?.({ type: "alea:error", message: msg, line: null });
            });

        return () => {
            cancelled = true;
        };
    }, [declaredLibrariesKey, explicitDeps, code, onError]);

    const activeDeps = explicitDeps ?? resolvedDeps;

    // Callbacks ref to avoid recreating sandbox on inline function changes
    const callbacksRef = useRef({ onReady, onError, onViolation });
    callbacksRef.current = { onReady, onError, onViolation };

    // Payload key to detect when code/seed/params actually changed
    const payloadKey = useMemo(() => {
        return JSON.stringify({
            code,
            seed,
            params: params ?? {},
            paramsSchema: paramsSchema ?? [],
            depsCount: activeDeps?.length ?? -1,
            liveClock,
            maxDpr,
            wantImage,
        });
    }, [code, seed, params, paramsSchema, activeDeps, liveClock, maxDpr, wantImage]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !activeDeps || libError) return;

        if (controllerRef.current) {
            controllerRef.current.destroy();
            controllerRef.current = null;
        }

        controllerRef.current = createSandbox(
            container,
            {
                code,
                seed,
                params,
                paramsSchema,
                deps: activeDeps,
                liveClock,
                maxDpr,
                wantImage,
            },
            {
                onReady: (p) => callbacksRef.current.onReady?.(p),
                onError: (p) => callbacksRef.current.onError?.(p),
                onViolation: (p) => callbacksRef.current.onViolation?.(p),
            },
        );

        return () => {
            if (controllerRef.current) {
                controllerRef.current.destroy();
                controllerRef.current = null;
            }
        };
    }, [payloadKey, activeDeps, libError, code, seed, params, paramsSchema, liveClock, maxDpr, wantImage]);

    return (
        <div
            ref={containerRef}
            className={className}
            style={{
                width: "100%",
                height: "100%",
                position: "relative",
                overflow: "hidden",
                ...style,
            }}
        />
    );
}
