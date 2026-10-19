"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IsolateFrame } from "@/components/IsolateFrame";
import { seedAt, randomSeed } from "@/lib/draft";
import type { ParamSpec } from "@/lib/params";
import { resolveParams } from "@/lib/params";
import { isBlankOrSolidBlack } from "@/lib/checks";

/**
 * The generator's cover: captured in the artist's browser, from the same
 * isolate that renders everything else, and pinned as a flat PNG. No provider
 * is involved, because a cover is marketing and not a token's image.
 *
 * Flat, and not a stored seed, because objkt will not run our isolate and a
 * list of generators cannot afford a live render per row. `set_metadata`
 * replaces it later, so the choice is not permanent. What a renderer reads to
 * decide what runs is written at origination and has no setter.
 */

/** Long edge of the full cover, and of the thumbnail. */
const DISPLAY_PX = 1200;
const THUMB_PX = 400;

/**
 * Redraw at a bounded size, never upscaling.
 *
 * Filled opaque first, because a canvas is transparent where nothing was drawn
 * and a transparent PNG composites against whatever a marketplace card uses.
 * Black, which is what the isolate puts behind a piece, so the capture matches
 * what the artist chose from.
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
    initialCover,
    onCaptured,
}: {
    html: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    deps?: string[];
    /** The draft's seed, so the choices here match the grid the artist knows. */
    baseSeed: string;
    initialCover?: { uri: string; thumbUri: string; seed: string } | null;
    onCaptured: (cover: { uri: string; thumbUri: string; seed: string } | null) => void;
}) {
    const [seed, setSeed] = useState(() => initialCover?.seed ?? seedAt(baseSeed, 0));
    const [seedInput, setSeedInput] = useState(() => initialCover?.seed ?? seedAt(baseSeed, 0));
    const [image, setImage] = useState<string | null>(null);
    const [pinned, setPinned] = useState<string | null>(() => initialCover?.uri ?? null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Why there are no pixels, when there are none. A disabled button with
    // nothing next to it is the same screen as a piece that has not drawn yet,
    // and an artist cannot tell which one they are looking at.
    const [uncapturable, setUncapturable] = useState<string | null>(null);
    const [allowBlack, setAllowBlack] = useState(false);
    const [copied, setCopied] = useState(false);
    const copyTimer = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        };
    }, []);

    const applySeed = useCallback(
        (raw: string) => {
            const next = raw.trim();
            if (!next || next === seed) return;
            setSeed(next);
            setImage(null);
            setUncapturable(null);
            setAllowBlack(false);
            if (next === initialCover?.seed && initialCover?.uri) {
                setPinned(initialCover.uri);
                onCaptured(initialCover);
            } else {
                setPinned(null);
                onCaptured(null);
            }
        },
        [seed, initialCover, onCaptured],
    );

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (seedInput.trim() && seedInput.trim() !== seed) {
                applySeed(seedInput);
            }
        }, 350);
        return () => window.clearTimeout(timer);
    }, [seedInput, seed, applySeed]);

    // Held from the last render so "use this one" needs no second run.
    const onReady = useCallback((d: { image: string | null; source: string }) => {
        setImage(d.image);
        if (d.image) {
            setUncapturable(null);
            void isBlankOrSolidBlack(d.image).then((blank) => {
                if (blank) {
                    setUncapturable(
                        "The captured image is completely black or empty. If using WebGL or Three.js, enable preserveDrawingBuffer: true. If drawing asynchronously, call $alea.ready() after rendering completes.",
                    );
                }
            });
        } else if (d.source === "none") {
            setUncapturable(
                "This piece draws in neither a canvas nor an SVG, so there is nothing here to photograph. A cover has to be captured from the piece itself, so give it one of the two and try again.",
            );
        } else {
            setUncapturable("The piece drew, but the picture could not be read back.");
        }
    }, []);

    // The piece threw. Without this the frame is black, the button never
    // enables, and nothing says why.
    const onError = useCallback((message: string) => {
        setUncapturable(`The piece stopped: ${message}`);
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
        if (uncapturable && !allowBlack) {
            setError(uncapturable);
            return;
        }
        const activeSeed = seed.trim() || seedInput.trim();
        if (!activeSeed) {
            setError("A seed is required to pin a cover.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            // Two sizes: a grid row or a marketplace card pulls the thumbnail
            // rather than a full capture for a 200px tile.
            const [full, thumb] = await Promise.all([
                downscale(image, DISPLAY_PX),
                downscale(image, THUMB_PX),
            ]);
            const [uri, thumbUri] = await Promise.all([
                pinOne(full, "cover.png"),
                pinOne(thumb, "cover-thumb.png"),
            ]);
            setPinned(uri);
            onCaptured({ uri, thumbUri, seed: activeSeed });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Pinning failed.");
        } finally {
            setBusy(false);
        }
    }

    function reroll() {
        const next = randomSeed();
        setSeedInput(next);
        setSeed(next);
        setImage(null);
        setPinned(null);
        setUncapturable(null);
        setAllowBlack(false);
        onCaptured(null);
    }

    function copySeed() {
        const toCopy = seedInput.trim() || seed;
        if (!toCopy || !navigator?.clipboard?.writeText) return;
        void navigator.clipboard.writeText(toCopy).then(
            () => {
                setCopied(true);
                if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
                copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
            },
            () => {},
        );
    }

    function onSeedInputChange(val: string) {
        setSeedInput(val);
    }

    function onSeedKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") {
            e.preventDefault();
            applySeed(seedInput);
        }
    }

    function onSeedBlur() {
        applySeed(seedInput);
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
                    onError={onError}
                />
            </div>

            <div className="max-w-xs space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                    <label htmlFor="cover-seed-input" className="font-medium text-foreground">
                        Cover seed
                    </label>
                    {pinned && <span className="text-[11px] text-muted-foreground">Pinned</span>}
                </div>
                <div className="flex items-center gap-1.5">
                    <input
                        id="cover-seed-input"
                        type="text"
                        value={seedInput}
                        onChange={(e) => onSeedInputChange(e.target.value)}
                        onKeyDown={onSeedKeyDown}
                        onBlur={onSeedBlur}
                        placeholder="Paste or enter a seed…"
                        disabled={busy}
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                    />
                    <button
                        type="button"
                        onClick={copySeed}
                        disabled={!seedInput.trim()}
                        title={copied ? "Copied" : "Copy seed"}
                        aria-label={copied ? "Seed copied" : "Copy seed"}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                        {copied ? (
                            <>
                                <Check size={12} className="text-success" aria-hidden />
                                <span className="text-[11px] text-success">Copied</span>
                            </>
                        ) : (
                            <>
                                <Copy size={12} aria-hidden />
                                <span className="text-[11px]">Copy</span>
                            </>
                        )}
                    </button>
                </div>
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
                    disabled={
                        busy ||
                        !image ||
                        Boolean(pinned) ||
                        (Boolean(uncapturable) && !allowBlack) ||
                        !seed.trim()
                    }
                    className="rounded-md bg-alea-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {busy ? "Pinning…" : pinned ? "Cover set" : "Use this one"}
                </button>
            </div>

            {(error || uncapturable) && (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                    <p>{error ?? uncapturable}</p>
                    {uncapturable?.includes("completely black") && (
                        <label className="flex items-center gap-2 pt-1 font-medium text-foreground">
                            <input
                                type="checkbox"
                                checked={allowBlack}
                                onChange={(e) => setAllowBlack(e.target.checked)}
                                className="rounded border-border"
                            />
                            <span>My piece is intentionally solid black</span>
                        </label>
                    )}
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                Shown wherever your generator is listed. You can change it later.
            </p>
        </div>
    );
}
