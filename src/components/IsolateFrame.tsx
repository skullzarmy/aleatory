"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ISOLATE_ORIGIN } from "@/lib/config";

/**
 * Runs a generator, wherever it came from.
 *
 * The isolate is a separate origin that executes and never fetches, so this
 * component's job is to hand it the code. That is the whole split: every
 * caller already knows how to get the code and differs in how, and the isolate
 * is the one participant that must have no network at all.
 *
 *   the studio   a draft out of IndexedDB, never on chain
 *   /piece/*     the app has already read collection storage
 *
 * The handshake matters. Posting before the isolate has parsed loses the
 * message with no error anywhere, so it announces itself and this waits.
 */
export function IsolateFrame({
    code,
    seed,
    params,
    paramsSchema,
    deps,
    wantImage,
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
    /** Ask for the pixels back, not just a digest. Used to capture a cover. */
    wantImage?: boolean;
    className?: string;
    title?: string;
    onReady?: (detail: { digest: string; image: string | null; violations: unknown[] }) => void;
    onViolation?: (kind: string, detail: string) => void;
    /** The piece threw. A blank frame and black paint look the same. */
    onError?: (message: string) => void;
}) {
    const ref = useRef<HTMLIFrameElement>(null);

    // Keyed on the payload's *content*, never on object identity. A caller that
    // builds params or deps inline hands us a new object every render, and
    // remounting on identity would remount forever without ever finishing the
    // handshake. Callers should memoise; this does not depend on them doing it.
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
            }),
        [code, seed, params, paramsSchema, deps, wantImage],
    );

    // A fresh document per change. Swapping the source underneath a piece that
    // has already drawn leaves a stale canvas, which reads as a working render.
    const [nonce, setNonce] = useState(0);
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        setNonce((n) => n + 1);
    }, [payload]);

    // Held in a ref so the listener registers once. Callbacks are usually
    // inline arrows, and re-registering on every render would drop the
    // handshake message somewhere between removals.
    const handlers = useRef({ onReady, onViolation, onError, payload });
    handlers.current = { onReady, onViolation, onError, payload };

    useEffect(() => {
        function onMessage(e: MessageEvent) {
            // `e.source` is the whole check, and it is a strong one: it is this
            // exact window object and nothing else can forge it.
            //
            // Origin is deliberately not checked. The frame is sandboxed
            // without `allow-same-origin`, so it lives in an opaque origin and
            // its messages arrive as `origin: "null"`. Comparing that against
            // the isolate's URL rejects every message it sends, which is what
            // made the frame sit there saying nothing had been sent to it.
            if (e.source !== ref.current?.contentWindow) return;

            const d = e.data as {
                type?: string;
                kind?: string;
                detail?: string;
                digest?: string;
                image?: string | null;
                violations?: unknown[];
                message?: string;
            };

            if (d?.type === "alea:hello") {
                // "*" for the same reason: an opaque origin cannot be named,
                // so a specific targetOrigin would drop the message silently.
                // Only this frame receives it, because we hold its window.
                ref.current?.contentWindow?.postMessage(
                    JSON.parse(handlers.current.payload),
                    "*",
                );
            }
            if (d?.type === "alea:ready") {
                handlers.current.onReady?.({
                    digest: d.digest ?? "",
                    image: d.image ?? null,
                    violations: d.violations ?? [],
                });
            }
            if (d?.type === "alea:violation") {
                handlers.current.onViolation?.(d.kind ?? "unknown", d.detail ?? "");
            }
            if (d?.type === "alea:error") {
                const msg = d.message ?? "Script error";
                if (!/localStorage|postMessage|MetaMask|chrome-extension|setup-wallet-sdk/i.test(msg)) {
                    handlers.current.onError?.(msg);
                }
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
