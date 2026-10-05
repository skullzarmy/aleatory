"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { IsolateFrame } from "@/components/IsolateFrame";
import { useDeps } from "@/components/useDeps";

/**
 * The artwork: a still first, the program on request.
 *
 * The code is the piece and the image is a photograph of it. Running artist
 * code costs the viewer's CPU and can hold the main thread, so the page opens
 * on the photograph, with the call to run the code in its corner. Nothing runs
 * until somebody asks.
 *
 * `running` and `onRunningChange` make it controlled, for a caller whose own
 * controls also ask for a draw (the generator page's Randomize and parameters).
 */
export function ArtifactFrame({
    code,
    seed,
    params,
    imageUrl,
    name,
    maxDpr,
    running: runningProp,
    onRunningChange,
}: {
    /** The generator, decoded from contract storage. */
    code?: string;
    seed?: string;
    params?: Record<string, unknown>;
    imageUrl?: string;
    name: string;
    /** Caps what `devicePixelRatio` reports inside the piece. Unset for the real one. */
    maxDpr?: number;
    running?: boolean;
    onRunningChange?: (running: boolean) => void;
}) {
    const runnable = Boolean(code && seed);
    /** True once the published image has actually arrived. */
    const [ready, setReady] = useState(false);
    const [runningOwn, setRunningOwn] = useState(false);
    const running = runnable && (runningProp ?? runningOwn);
    const setRunning = (next: boolean) => {
        setRunningOwn(next);
        onRunningChange?.(next);
    };

    // Bumping this remounts the element, which re-requests the image, so one
    // dropped request does not cost the published image for the page's life.
    const [attempt, setAttempt] = useState(0);
    const timer = useRef(0);
    useEffect(() => {
        setReady(false);
        setAttempt(0);
    }, [imageUrl]);
    useEffect(() => () => window.clearTimeout(timer.current), []);

    // The button that was pressed unmounts with the state it toggles, so focus
    // follows to its counterpart instead of falling to the document.
    const runRef = useRef<HTMLButtonElement>(null);
    const stopRef = useRef<HTMLButtonElement>(null);
    const toggled = useRef(false);
    useEffect(() => {
        if (!toggled.current) return;
        toggled.current = false;
        (running ? stopRef : runRef).current?.focus();
    }, [running]);
    const toggle = (next: boolean) => {
        toggled.current = true;
        setRunning(next);
    };

    // The libraries the generator declares, fetched and handed over as source.
    // The isolate runs under `connect-src 'none'` and a `script-src` naming no
    // host, so it can neither fetch a library nor load one by URL: whatever it
    // is not given, it cannot have. Fetched only once there is a run to feed.
    const { deps, ready: depsReady, error: depsError } = useDeps(running ? (code ?? "") : "");
    // A frame mounted before its libraries arrive runs once without them.
    const drawing = running && (depsReady || depsError !== null);

    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-card-background">
            {drawing && (
                <IsolateFrame
                    code={code as string}
                    seed={seed as string}
                    params={params}
                    deps={deps}
                    liveClock
                    maxDpr={maxDpr}
                    title={name}
                    className="h-full w-full border-0"
                />
            )}

            {/* Mounted while it loads so the fetch starts, invisible until it
                has something to show. */}
            {imageUrl && !running && (
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
                        ready ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                />
            )}

            {running && !drawing && (
                <div className="pending-shimmer flex h-full w-full items-center justify-center">
                    <span className="text-sm text-muted-foreground">Loading libraries</span>
                </div>
            )}

            {!running && !ready && (
                <div
                    className={`flex h-full w-full items-center justify-center ${
                        imageUrl ? "pending-shimmer" : "bg-muted"
                    }`}
                >
                    {!runnable && (
                        <span className="text-sm text-muted-foreground">Awaiting render</span>
                    )}
                </div>
            )}

            {runnable && !running && (
                <button
                    ref={runRef}
                    type="button"
                    onClick={() => toggle(true)}
                    className="run-beckon absolute bottom-3 right-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                    <Play className="h-4 w-4 fill-current" aria-hidden />
                    Run the code
                </button>
            )}

            {running && (
                <button
                    ref={stopRef}
                    type="button"
                    onClick={() => toggle(false)}
                    className="absolute bottom-3 right-3 inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs font-medium backdrop-blur transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Square className="h-3.5 w-3.5" aria-hidden /> Stop
                </button>
            )}
        </div>
    );
}
