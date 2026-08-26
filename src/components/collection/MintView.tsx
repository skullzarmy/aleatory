"use client";

import { useState } from "react";
import { ArtifactFrame } from "@/components/piece/ArtifactFrame";
import { MintPanel } from "./MintPanel";
import type { Collection } from "@/lib/collection";
import type { ParamsSchema } from "@/lib/params";

/**
 * The preview and the mint form, which have to share state.
 *
 * Randomize changes what is drawn, so the frame and the panel cannot be two
 * islands on a server-rendered page. This owns the values and the preview seed
 * and hands both down.
 *
 * The seed here is a stand-in and the panel says so. A collector's real seed is
 * the hash of the operation they have not sent yet, so nothing on this page can
 * know it. What the preview is for is showing the space they are buying into,
 * and what Randomize changes is which draw from it they are looking at.
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
            <div>
                <ArtifactFrame
                    code={collection.code}
                    seed={previewSeed}
                    params={values}
                    name="Generator preview"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                    One draw from this generator. Yours will be different, and nobody knows
                    how until you sign.
                </p>
            </div>

            <div className="space-y-4">
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
