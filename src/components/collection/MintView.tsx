"use client";

import { useState } from "react";
import { ArtifactFrame } from "@/components/piece/ArtifactFrame";
import { MintPanel } from "./MintPanel";
import type { Collection } from "@/lib/collection";
import type { ParamsSchema } from "@/lib/params";

/**
 * The preview and the mint form, which share state: Randomize changes what is
 * drawn, so this owns the values and the preview seed and hands both down.
 *
 * That seed is a stand-in, and the panel says so. A collector's real seed is
 * the hash of an operation they have not sent, so the preview shows the space
 * they are buying into and not the draw they will get.
 */
export function MintView({
    collection,
    schema,
}: {
    collection: Collection;
    schema?: ParamsSchema | null;
}) {
    // Starts on the collection's own address, so every visitor sees the same
    // first draw and the page is stable rather than reshuffling on load.
    const [previewSeed, setPreviewSeed] = useState(collection.address);
    const [values, setValues] = useState<Record<string, unknown>>({});

    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
                <ArtifactFrame
                    code={collection.code}
                    seed={previewSeed}
                    params={values}
                    name="Generator preview"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                    One draw from this generator. Yours will be different, and nobody knows how
                    until you sign.
                </p>
            </div>

            <div className="min-w-0 space-y-4">
                <MintPanel
                    collection={collection}
                    schema={schema}
                    onPreview={(next, seed) => {
                        setValues(next);
                        // An empty seed means only the parameters moved, so the
                        // draw stays put and the change is attributable.
                        if (seed) setPreviewSeed(seed);
                    }}
                />
            </div>
        </div>
    );
}
