"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ISOLATE_ORIGIN } from "@/lib/config";

/**
 * Runs a generator, wherever it came from. The isolate is a separate origin
 * that executes and never fetches, so callers bring the code: the studio from
 * IndexedDB, `/piece/*` from generator storage.
 *
 * Posting before the isolate has parsed loses the message with no error
 * anywhere, so it announces itself and this waits.
 */
export function IsolateFrame({
    code,
    seed,
    params,
    paramsSchema,
    deps,
    wantImage,
    liveClock,
    className,
    title = "Piece",
    onReady,
    onViolation,
    onError,
}: {
    /** The generator source. Decoded already: the isolate does not decompress. */
    code: string;
    seed: string;
    params?: Record<string, unknown>;
    paramsSchema?: unknown[];
    /** Library sources, inlined ahead of the artist's code. */
    deps?: string[];
    /**
     * Let the clock run. Off by default, because a capture and the studio's
     * determinism check both need the same seed to draw the same picture. A
     * viewer turns it on: an animated piece with a frozen clock sits on its
     * first frame forever.
     */
    liveClock?: boolean;
    /** Ask for the pixels back, not just a digest. Used to capture a cover. */
    wantImage?: boolean;
    className?: string;
    title?: string;
    onReady?: (detail: {
        digest: string;
        image: string | null;
        /** What the capture came from, so a caller needing pixels can say why it has none. */
        source: "canvas" | "svg" | "none";
        violations: unknown[];
    }) => void;
    onViolation?: (kind: string, detail: string) => void;
    /** The piece threw. A blank frame and black paint look the same. */
    onError?: (message: string) => void;
}) {
    const ref = useRef<HTMLIFrameElement>(null);

    // Keyed on the payload's content, never on object identity: a caller that
    // builds params or deps inline hands over a new object every render, and
    // remounting on that never finishes the handshake.
    const payload = useMemo(
        () =>
            JSON.stringify({
                type: "alea:run",
                code,
                seed,
                params: params ?? {},
                paramsSchema: paramsSchema ?? [],
                deps: deps ?? [],
                wantImage: Boolean(wantImage),
                freezeClock: !liveClock,
            }),
        [code, seed, params, paramsSchema, deps, wantImage, liveClock],
    );

    // A fresh document per change. Swapping the source under a piece that has
    // drawn leaves a stale canvas, which reads as a working render.
    const [nonce, setNonce] = useState(0);
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        setNonce((n) => n + 1);
    }, [payload]);

    // A ref so the listener registers once. Callbacks are usually inline
    // arrows, and re-registering drops the handshake message between removals.
    const handlers = useRef({ onReady, onViolation, onError, payload });
    handlers.current = { onReady, onViolation, onError, payload };

    useEffect(() => {
        function onMessage(e: MessageEvent) {
            // `e.source` is the whole check: this exact window object, which
            // nothing else can forge. Origin is not checked, because the frame
            // is sandboxed without `allow-same-origin` and so sends
            // `origin: "null"`, which matches no URL.
            if (e.source !== ref.current?.contentWindow) return;

            const d = e.data as {
                type?: string;
                kind?: string;
                detail?: string;
                digest?: string;
                image?: string | null;
                source?: "canvas" | "svg" | "none";
                violations?: unknown[];
                message?: string;
            };

            if (d?.type === "alea:hello") {
                // "*" because an opaque origin cannot be named. Only this frame
                // receives it, since the window object is the target.
                ref.current?.contentWindow?.postMessage(JSON.parse(handlers.current.payload), "*");
            }
            if (d?.type === "alea:ready") {
                handlers.current.onReady?.({
                    digest: d.digest ?? "",
                    image: d.image ?? null,
                    source: d.source ?? "none",
                    violations: d.violations ?? [],
                });
            }
            if (d?.type === "alea:violation") {
                handlers.current.onViolation?.(d.kind ?? "unknown", d.detail ?? "");
            }
            if (d?.type === "alea:error") {
                handlers.current.onError?.(d.message ?? "Script error");
            }
        }

        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    return (
        <iframe
            key={nonce}
            ref={ref}
            src={ISOLATE_ORIGIN}
            title={title}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className={className ?? "h-full w-full border-0"}
        />
    );
}
