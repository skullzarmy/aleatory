"use client";

import { useCallback, useState } from "react";
import { IsolateFrame } from "@/components/IsolateFrame";
import { seedAt, randomSeed } from "@/lib/draft";
import type { ParamSpec } from "@/lib/params";
import { resolveParams } from "@/lib/params";

/**
 * The collection's cover.
 *
 * Captured in the artist's own browser, from the same isolate that renders
 * everything else, and pinned as a flat PNG. No provider is involved: a cover
 * is marketing, not a token's image, and nobody's property depends on it. What
 * pieces need the provider for is an image produced deterministically and
 * written on chain by an authorised writer, and none of that applies here.
 *
 * A flat image rather than a stored seed because the surfaces that matter most
 * are the ones we do not control. objkt will not run our isolate, and a list of
 * collections cannot afford a live render per row.
 *
 * The artist picks the seed, which is the right person and the right moment:
 * they have been reading the seed grid all week and know which draw represents
 * the space. `set_metadata` lets them replace it later, so a hasty choice is
 * not permanent.
 */
/** Long edge of the full cover, and of the thumbnail. */
const DISPLAY_PX = 1200;
const THUMB_PX = 400;

/**
 * Redraw at a bounded size.
 *
 * Never upscales: a generator that drew at 600px stays at 600px rather than
 * being blown up to look worse.
 *
 * Filled opaque first. A canvas is transparent where nothing was drawn, and a
 * transparent PNG composites against whatever a marketplace card happens to
 * use, so the cover would look one way here and another on objkt. Black,
 * because that is what the isolate puts behind a piece, so the capture matches
 * what the artist was looking at when they chose it.
 */
async function downscale(dataUrl: string, maxPx: number): Promise<string> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("The capture could not be read."));
        el.src = dataUrl;
    });

    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

export function CoverPicker({
    html,
    params,
    values,
    deps,
    baseSeed,
    onCaptured,
}: {
    html: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    deps?: string[];
    /** The draft's seed, so the choices here match the grid the artist knows. */
    baseSeed: string;
    onCaptured: (cover: { uri: string; thumbUri: string; seed: string } | null) => void;
}) {
    const [seed, setSeed] = useState(() => seedAt(baseSeed, 0));
    const [image, setImage] = useState<string | null>(null);
    const [pinned, setPinned] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Held from the last render so "use this one" needs no second run.
    const onReady = useCallback((d: { image: string | null }) => {
        setImage(d.image);
    }, []);

    const resolved = resolveParams(params, values ?? {});

    async function pinOne(dataUrl: string, name: string): Promise<string> {
        const res = await fetch("/api/pin", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "image", content: dataUrl, name }),
        });
        const json = (await res.json().catch(() => ({}))) as { uri?: string; error?: string };
        if (!res.ok || !json.uri) throw new Error(json.error || "Pinning failed.");
        return json.uri;
    }

    async function pin() {
        if (!image) {
            setError("The piece has not finished drawing yet.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            // Two sizes, because they are read in different places. A grid row
            // or a marketplace card pulls the thumbnail, and pulling a full
            // capture for a 200px tile is how a listing page gets slow.
            const [full, thumb] = await Promise.all([
                downscale(image, DISPLAY_PX),
                downscale(image, THUMB_PX),
            ]);
            const [uri, thumbUri] = await Promise.all([
                pinOne(full, "cover.png"),
                pinOne(thumb, "cover-thumb.png"),
            ]);
            setPinned(uri);
            onCaptured({ uri, thumbUri, seed });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Pinning failed.");
        } finally {
            setBusy(false);
        }
    }

    function reroll() {
        setImage(null);
        setPinned(null);
        onCaptured(null);
        setSeed(randomSeed());
    }

    return (
        <div className="space-y-3">
            <div className="relative aspect-square max-w-xs overflow-hidden rounded-lg border border-border">
                <IsolateFrame
                    code={html}
                    seed={seed}
                    params={resolved}
                    paramsSchema={params}
                    deps={deps}
                    wantImage
                    title="Cover"
                    onReady={onReady}
                />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={reroll}
                    disabled={busy}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
                >
                    Another
                </button>
                <button
                    type="button"
                    onClick={() => void pin()}
                    disabled={busy || !image || Boolean(pinned)}
                    className="rounded-md bg-alea-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {busy ? "Pinning…" : pinned ? "Cover set" : "Use this one"}
                </button>
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {seed}
                </code>
            </div>

            {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                    {error}
                </p>
            )}

            <p className="text-xs text-muted-foreground">
                Shown wherever your collection is listed. You can change it later.
            </p>
        </div>
    );
}
