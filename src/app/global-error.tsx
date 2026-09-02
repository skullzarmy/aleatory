"use client";

import { useEffect, useRef } from "react";

/**
 * When the layout itself throws.
 *
 * `error.tsx` sits inside the layout, so a failure in the layout takes that
 * boundary down with it. This one replaces the whole document, which is why it
 * renders its own `<html>` and `<body>` and imports nothing: no theme, no
 * fonts, no components, no stylesheet, nothing that could be the thing that
 * just broke. Its own random number generator, its own colours, inline.
 *
 * The piece is a collapse. Points fall inward toward a centre that no longer
 * holds them, tracing where they were on the way. Seeded by the digest, so
 * this failure has one picture. It should never be seen.
 */

/** Same generator as the rest of the site, inlined because nothing is imported. */
function makeRandom(seed: string): () => number {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
}

function CollapseArt({ seed }: { seed: string }) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = window.innerWidth;
        const H = window.innerHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";

        const rand = makeRandom(seed);
        const cx = W / 2;
        const cy = H / 2;
        const unit = Math.min(W, H);

        const points = Array.from({ length: 260 }, () => {
            const a = rand() * Math.PI * 2;
            const r = unit * (0.25 + rand() * 0.5);
            return {
                x: cx + Math.cos(a) * r,
                y: cy + Math.sin(a) * r,
                pull: 0.004 + rand() * 0.016,
                width: 0.4 + rand() * 1.2,
                alpha: 0.1 + rand() * 0.3,
                warm: rand() < 0.18,
            };
        });

        const step = () => {
            for (const p of points) {
                const nx = p.x + (cx - p.x) * p.pull;
                const ny = p.y + (cy - p.y) * p.pull;
                ctx.strokeStyle = p.warm ? "#d9b46a" : "#8a8b93";
                ctx.globalAlpha = p.alpha;
                ctx.lineWidth = p.width;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(nx, ny);
                ctx.stroke();
                p.x = nx;
                p.y = ny;
            }
            ctx.globalAlpha = 1;
        };

        if (reduced) {
            for (let i = 0; i < 300; i++) step();
            return;
        }

        let raf = 0;
        let frames = 0;
        const tick = () => {
            step();
            frames++;
            raf = frames < 300 ? requestAnimationFrame(tick) : 0;
        };
        raf = requestAnimationFrame(tick);
        return () => {
            if (raf) cancelAnimationFrame(raf);
        };
    }, [seed]);

    return (
        <canvas
            ref={ref}
            aria-hidden="true"
            style={{
                position: "fixed",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
            }}
        />
    );
}

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    minHeight: "100vh",
                    display: "grid",
                    placeItems: "center",
                    background: "#0f1012",
                    color: "#e8e8ea",
                    fontFamily: "ui-sans-serif, system-ui, sans-serif",
                    padding: "2rem",
                    textAlign: "center",
                }}
            >
                <CollapseArt seed={error.digest ?? error.message ?? "collapse"} />
                <main
                    style={{
                        position: "relative",
                        zIndex: 1,
                        maxWidth: "32rem",
                        borderRadius: "0.75rem",
                        border: "1px solid #2a2b31",
                        background: "rgba(15,16,18,0.9)",
                        backdropFilter: "blur(8px)",
                        padding: "2.5rem 1.5rem",
                    }}
                >
                    <p
                        style={{
                            margin: 0,
                            fontFamily: "ui-monospace, monospace",
                            fontSize: "0.875rem",
                            letterSpacing: "0.3em",
                            opacity: 0.55,
                        }}
                    >
                        500
                    </p>
                    <h1 style={{ marginTop: "1rem", fontSize: "1.5rem", fontWeight: 600 }}>
                        Aleatory could not start
                    </h1>
                    <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", opacity: 0.7 }}>
                        Every piece is stored on chain and is untouched by this. The site is one way
                        to see them, and it is the only thing that failed.
                    </p>
                    <button
                        type="button"
                        onClick={reset}
                        style={{
                            marginTop: "2rem",
                            minHeight: 44,
                            padding: "0.5rem 1rem",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            borderRadius: "0.375rem",
                            border: "1px solid #33343a",
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                    {error.digest && (
                        <p
                            style={{
                                marginTop: "1.5rem",
                                fontFamily: "ui-monospace, monospace",
                                fontSize: "0.75rem",
                                opacity: 0.5,
                            }}
                        >
                            {error.digest}
                        </p>
                    )}
                </main>
            </body>
        </html>
    );
}
