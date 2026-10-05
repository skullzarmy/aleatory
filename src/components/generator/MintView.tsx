"use client";

import { useState } from "react";
import { ArtifactFrame } from "@/components/piece/ArtifactFrame";
import { MintPanel } from "./MintPanel";
import type { Generator } from "@/lib/generator";
import type { ParamsSchema } from "@/lib/params";
import { maxDprFor } from "@/lib/renderLimits";
import { ShareButtons, type ArtistHandles } from "@/components/ShareButtons";

/**
 * The preview and the mint form, which share state: Randomize changes what is
 * drawn, so this owns the values and the preview seed and hands both down.
 * The preview opens on the cover, and Randomize or a parameter starts it
 * running, since either is a request to see a draw.
 *
 * That seed is a stand-in, and the panel says so. A collector's real seed is
 * the hash of an operation they have not sent, so the preview shows the space
 * they are buying into and not the draw they will get.
 */
export function MintView({
    generator,
    schema,
    coverUrl,
    shareUrl,
    shareText,
    artistHandles,
}: {
    generator: Generator;
    schema?: ParamsSchema | null;
    /** The artist's cover, or the newest rendered piece. */
    coverUrl?: string;
    shareUrl: string;
    shareText: string;
    artistHandles?: ArtistHandles;
}) {
    // Starts on the generator's own address, so every visitor sees the same
    // first draw and the page is stable rather than reshuffling on load.
    const [previewSeed, setPreviewSeed] = useState(generator.address);
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [running, setRunning] = useState(false);

    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
                <ArtifactFrame
                    code={generator.code}
                    seed={previewSeed}
                    params={values}
                    imageUrl={coverUrl}
                    name="Generator preview"
                    maxDpr={maxDprFor(generator.address)}
                    running={running}
                    onRunningChange={setRunning}
                />
                {running && (
                    <p className="mt-2 text-xs text-muted-foreground">
                        One draw from this generator. Yours will be different, and nobody knows how
                        until you sign.
                    </p>
                )}
            </div>

            <div className="min-w-0 space-y-4">
                <MintPanel
                    generator={generator}
                    schema={schema}
                    onPreview={(next, seed) => {
                        setValues(next);
                        setRunning(true);
                        // An empty seed means only the parameters moved, so the
                        // draw stays put and the change is attributable.
                        if (seed) setPreviewSeed(seed);
                    }}
                />
                {generator.description && (
                    <p className="whitespace-pre-line break-words text-sm text-muted-foreground">
                        {generator.description}
                    </p>
                )}
                {generator.tags && generator.tags.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Tags: {generator.tags.join(", ")}
                    </p>
                )}
                <ShareButtons url={shareUrl} text={shareText} artistHandles={artistHandles} />
            </div>
        </div>
    );
}
