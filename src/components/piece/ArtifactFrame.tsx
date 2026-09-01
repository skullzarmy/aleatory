"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Play } from "lucide-react";
import { IsolateFrame } from "@/components/IsolateFrame";

/**
 * The artwork.
 *
 * Generator code runs in a sandboxed frame on a separate origin, so it has no
 * reach into wallet state or session storage on this one. The `sandbox`
 * attribute allows scripts and nothing else.
 *
 * **The piece is drawn from the chain first, and the published image replaces
 * it once it has actually loaded.** A piece is a pure function of its code and
 * its seed, both of which are on chain and already in this page, so there is
 * never a reason to show a spinner, a broken image, or an empty square while a
 * gateway is thinking. The canonical image is worth waiting for and worth
 * nothing to wait *on*.
 *
 * So the load is a background upgrade. It fades in over the live render when
 * it arrives, and a gateway that 404s or times out costs the viewer nothing:
 * they are already looking at the piece.
 */
export function ArtifactFrame({
    code,
    seed,
    params,
    imageUrl,
    name,
}: {
    /** The generator, decoded from contract storage. */
    code?: string;
    seed?: string;
    params?: Record<string, unknown>;
    imageUrl?: string;
    name: string;
}) {
    const runnable = Boolean(code && seed);
    /** True once the published image has actually arrived. */
    const [ready, setReady] = useState(false);
    /** What the viewer asked for, once they have asked. */
    const [prefer, setPrefer] = useState<"image" | "live" | null>(null);

    // Bumping this remounts the element, which is what re-requests the image.
    // A failure used to be terminal: the element came down, nothing asked
    // again, and the toggle it gates was gone for the life of the page. One
    // dropped request should not cost somebody the published image.
    const [attempt, setAttempt] = useState(0);
    const timer = useRef(0);
    useEffect(() => {
        setReady(false);
        setAttempt(0);
    }, [imageUrl]);
    useEffect(() => () => window.clearTimeout(timer.current), []);

    // The image when it is there and wanted, the live render whenever it is
    // not: still loading, failed, or switched away from.
    const showImage = ready && prefer !== "live";
    const showLive = runnable && !showImage;

    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-card-background">
            {showLive && (
                <IsolateFrame
                    code={code as string}
                    seed={seed as string}
                    params={params}
                    title={name}
                    className="h-full w-full border-0"
                />
            )}

            {/* Mounted while it loads so the fetch starts, and kept out of the
                way until it has something to show. A failure leaves it mounted
                and invisible, which costs the viewer nothing: the piece is
                already running underneath it. */}
            {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={attempt}
                    src={imageUrl}
                    alt={name}
                    onLoad={() => setReady(true)}
                    onError={() => {
                        // Once, on the same URL. A failed response was never
                        // cached, so this is a real second request, and a blip
                        // is the case worth covering. If it fails again the
                        // live render stands, which is the honest answer.
                        if (attempt > 0) return;
                        timer.current = window.setTimeout(
                            () => setAttempt((n) => n + 1),
                            1500,
                        );
                    }}
                    className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
                        showImage ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                />
            )}

            {!showLive && !showImage && (
                <div className="pending-shimmer flex h-full w-full items-center justify-center">
                    <span className="text-sm text-muted-foreground">Awaiting render</span>
                </div>
            )}

            {/* Offered only once there are two things to choose between. */}
            {runnable && ready && (
                <button
                    type="button"
                    onClick={() => setPrefer(showImage ? "live" : "image")}
                    className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs font-medium backdrop-blur transition-colors hover:bg-accent"
                >
                    {showImage ? (
                        <>
                            <Play className="h-3.5 w-3.5" /> Run it
                        </>
                    ) : (
                        <>
                            <ImageIcon className="h-3.5 w-3.5" /> Image
                        </>
                    )}
                </button>
            )}
        </div>
    );
}
