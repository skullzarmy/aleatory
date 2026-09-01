"use client";

import { useState } from "react";
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
    /** null while the gateway is still deciding. */
    const [loaded, setLoaded] = useState<boolean | null>(imageUrl ? null : false);
    /** What the viewer asked for, once they have asked. */
    const [prefer, setPrefer] = useState<"image" | "live" | null>(null);

    // The image when it is there and wanted, the live render whenever it is
    // not: still loading, failed, or switched away from.
    const showImage = Boolean(imageUrl) && loaded === true && prefer !== "live";
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
                way until it has something to show. `loaded === false` after an
                error, which is the state that never puts it on screen. */}
            {imageUrl && loaded !== false && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={imageUrl}
                    alt={name}
                    onLoad={() => setLoaded(true)}
                    onError={() => setLoaded(false)}
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
            {runnable && loaded === true && (
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
