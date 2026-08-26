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
 * A published image shows first when there is one, and the live render is one
 * click away. Where no image exists yet, the live render is the piece.
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
    const [live, setLive] = useState(!imageUrl);

    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-card-background">
            {live && runnable ? (
                <IsolateFrame
                    code={code as string}
                    seed={seed as string}
                    params={params}
                    title={name}
                    className="h-full w-full border-0"
                />
            ) : imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={name} className="h-full w-full object-contain" />
            ) : (
                <div className="pending-shimmer flex h-full w-full items-center justify-center">
                    <span className="text-sm text-muted-foreground">Awaiting render</span>
                </div>
            )}

            {runnable && imageUrl && (
                <button
                    type="button"
                    onClick={() => setLive((v) => !v)}
                    className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs font-medium backdrop-blur transition-colors hover:bg-accent"
                >
                    {live ? (
                        <>
                            <ImageIcon className="h-3.5 w-3.5" /> Image
                        </>
                    ) : (
                        <>
                            <Play className="h-3.5 w-3.5" /> Run it
                        </>
                    )}
                </button>
            )}
        </div>
    );
}
