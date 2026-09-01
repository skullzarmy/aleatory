"use client";

/**
 * The error page, generated.
 *
 * The seed is the error's digest. The same failure draws the same picture
 * every time, so two people hitting one bug are looking at one piece, and a
 * fixed bug takes its picture with it.
 *
 * A fracture: a stress point, and cracks that run outward branching as they
 * go, each one losing energy until it stops. Nothing is repaired and nothing
 * loops. It propagates once, slows, and rests, and the last frame is the
 * piece. Decorative, so it is aria-hidden and the words carry the meaning.
 */

import { useEffect, useRef } from "react";
import { makeRandom } from "@/lib/logo";

const TAU = Math.PI * 2;
const GOLD = "#d9b46a";
const RED = "#c8553d";
const DURATION = 4200;

function readVar(name: string, fallback: string) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

interface Crack {
    x: number;
    y: number;
    angle: number;
    /** How much running is left in it. A crack dies when this reaches zero. */
    energy: number;
    width: number;
    color: string;
    alpha: number;
}

export function ErrorArt({ seed }: { seed: string }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        let ink = readVar("--foreground", "0 0% 40%");
        let W = 0;
        let H = 0;
        let live: Crack[] = [];
        let rand = makeRandom(seed);

        const build = () => {
            rand = makeRandom(seed);
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const rect = wrap.getBoundingClientRect();
            W = Math.max(1, Math.round(rect.width));
            H = Math.max(1, Math.round(rect.height));
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            ctx.lineCap = "round";

            // One impact, off centre, and a handful of cracks leaving it.
            const ox = W * (0.35 + rand() * 0.3);
            const oy = H * (0.35 + rand() * 0.3);
            const unit = Math.min(W, H);
            const arms = 4 + Math.floor(rand() * 4);
            const turn = rand() * TAU;

            live = [];
            for (let i = 0; i < arms; i++) {
                live.push({
                    x: ox,
                    y: oy,
                    angle: turn + (TAU * i) / arms + (rand() - 0.5) * 0.6,
                    energy: unit * (0.25 + rand() * 0.4),
                    width: 0.6 + rand() * 1.6,
                    color: rand() < 0.22 ? (rand() < 0.5 ? GOLD : RED) : "ink",
                    alpha: 0.25 + rand() * 0.4,
                });
            }
        };

        /** One advance of every crack still running. */
        const step = (scale: number) => {
            const unit = Math.min(W, H);
            const next: Crack[] = [];
            for (const c of live) {
                if (c.energy <= 0) continue;
                const len = unit * 0.012 * scale;
                // A crack wanders as it runs, more as it weakens.
                const wobble = (rand() - 0.5) * 0.35 * (1 - c.energy / unit);
                const a = c.angle + wobble;
                const nx = c.x + Math.cos(a) * len;
                const ny = c.y + Math.sin(a) * len;

                ctx.strokeStyle = c.color === "ink" ? `hsl(${ink})` : c.color;
                ctx.globalAlpha = c.alpha;
                ctx.lineWidth = c.width;
                ctx.beginPath();
                ctx.moveTo(c.x, c.y);
                ctx.lineTo(nx, ny);
                ctx.stroke();

                c.x = nx;
                c.y = ny;
                c.angle = a;
                c.energy -= len;

                if (nx < -20 || nx > W + 20 || ny < -20 || ny > H + 20) c.energy = 0;
                if (c.energy > 0) next.push(c);

                // Branching, rarely, and the child is always the weaker half.
                if (c.energy > unit * 0.08 && rand() < 0.035 && next.length < 220) {
                    next.push({
                        x: nx,
                        y: ny,
                        angle: a + (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.7),
                        energy: c.energy * (0.3 + rand() * 0.3),
                        width: Math.max(0.4, c.width * 0.7),
                        color: c.color,
                        alpha: c.alpha * 0.85,
                    });
                    c.energy *= 0.75;
                }
            }
            live = next;
            ctx.globalAlpha = 1;
        };

        const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

        let raf = 0;
        let start = 0;
        const frame = (now: number) => {
            if (!start) start = now;
            const progress = Math.min(1, (now - start) / DURATION);
            step(easeOut(1 - progress) * 1.6 + 0.15);
            raf = progress < 1 && live.length > 0 ? requestAnimationFrame(frame) : 0;
        };

        const render = () => {
            build();
            if (reduced.matches) {
                // The finished fracture, in one pass. No motion.
                for (let i = 0; i < 400 && live.length > 0; i++) step(1);
                return;
            }
            start = 0;
            raf = requestAnimationFrame(frame);
        };
        const stop = () => {
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
        };

        render();

        let resizeTimer = 0;
        const ro = new ResizeObserver(() => {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                stop();
                render();
            }, 150);
        });
        ro.observe(wrap);

        const onVis = () => {
            if (document.hidden) stop();
        };
        document.addEventListener("visibilitychange", onVis);

        const mo = new MutationObserver(() => {
            ink = readVar("--foreground", "0 0% 40%");
            stop();
            render();
        });
        mo.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });

        return () => {
            stop();
            window.clearTimeout(resizeTimer);
            ro.disconnect();
            mo.disconnect();
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [seed]);

    return (
        <div
            ref={wrapRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
        >
            <canvas ref={canvasRef} className="h-full w-full" />
        </div>
    );
}
