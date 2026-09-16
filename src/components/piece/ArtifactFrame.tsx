"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Play } from "lucide-react";
import { IsolateFrame } from "@/components/IsolateFrame";
import { useDeps } from "@/components/useDeps";

/**
 * The artwork, run from the chain.
 *
 * The code is the piece and the image is a photograph of it, so the code is
 * what plays here and the image is what stands in when it cannot. That is the
 * claim this whole project makes, and a page that quietly preferred the
 * cheaper thing would be making it dishonestly.
 *
 * A piece is a pure function of its code and its seed, both already in this
 * page, so nothing here waits on a gateway. The image is still fetched: it is
 * what a viewer gets when the generator has no code to run, and what they can
 * ask for when they would rather have a still.
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

    // Bumping this remounts the element, which re-requests the image, so one
    // dropped request does not cost the published image for the page's life.
    const [attempt, setAttempt] = useState(0);
    const timer = useRef(0);
    useEffect(() => {
        setReady(false);
        setAttempt(0);
    }, [imageUrl]);
    useEffect(() => () => window.clearTimeout(timer.current), []);

    // The code runs unless it cannot, or unless the viewer asked for the still.
    const showLive = runnable && prefer !== "image";
    const showImage = !showLive && ready;

    // The libraries the generator declares, fetched and handed over as source.
    // The isolate runs under `connect-src 'none'` and a `script-src` naming no
    // host, so it can neither fetch a library nor load one by URL: whatever it
    // is not given, it cannot have.
    const { deps } = useDeps(code ?? "");

    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-card-background">
            {showLive && (
                <IsolateFrame
                    code={code as string}
                    seed={seed as string}
                    params={params}
                    deps={deps}
                    liveClock
                    title={name}
                    className="h-full w-full border-0"
                />
            )}

            {/* Mounted while it loads so the fetch starts, invisible until it
                has something to show. */}
            {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={attempt}
                    src={imageUrl}
                    alt={name}
                    onLoad={() => setReady(true)}
                    onError={() => {
                        // Once, on the same URL. A failed response was not
                        // cached, so this is a real second request.
                        if (attempt > 0) return;
                        timer.current = window.setTimeout(() => setAttempt((n) => n + 1), 1500);
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
                    onClick={() => setPrefer(showLive ? "image" : "live")}
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
