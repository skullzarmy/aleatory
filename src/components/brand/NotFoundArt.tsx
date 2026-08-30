"use client";

/**
 * The 404, generated.
 *
 * The seed is the address you asked for. A wrong turn is still a seed, so the
 * page you never reached still draws one piece and only one, the same every
 * time that same wrong link is followed.
 *
 * A flow field: a still, seeded noise decides a direction at every point, and
 * a few hundred travellers are let loose to follow it. None of them knows the
 * others; the shape is what their agreement makes. It draws itself, eases to a
 * stop, and rests — finite motion, so nothing moves forever, and the last
 * frame is the piece. Decorative, so it is aria-hidden and the words carry the
 * meaning.
 */

import { useEffect, useRef, useState } from "react";
import { makeRandom } from "@/lib/logo";

const TAU = Math.PI * 2;
const GOLD = "#d9b46a";
const BLUE = "#4770e1";
const DURATION = 7000;

function readVar(name: string, fallback: string) {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    return v || fallback;
}

/** Seeded value noise, two octaves. Same seed, same field, always. */
function makeField(rand: () => number) {
    const N = 256;
    const perm = new Uint8Array(N * 2);
    const vals = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        perm[i] = i;
        vals[i] = rand();
    }
    for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = perm[i];
        perm[i] = perm[j];
        perm[j] = t;
    }
    for (let i = 0; i < N; i++) perm[i + N] = perm[i];

    const fade = (t: number) => t * t * (3 - 2 * t);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const hash = (xi: number, yi: number) =>
        perm[(perm[xi & 255] + (yi & 255)) & 255];

    const octave = (x: number, y: number) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;
        const u = fade(xf);
        const v = fade(yf);
        return lerp(
            lerp(vals[hash(xi, yi)], vals[hash(xi + 1, yi)], u),
            lerp(vals[hash(xi, yi + 1)], vals[hash(xi + 1, yi + 1)], u),
            v,
        );
    };

    return (x: number, y: number) =>
        octave(x, y) * 0.65 + octave(x * 2.17, y * 2.17) * 0.35;
}

type Particle = {
    x: number;
    y: number;
    color: string;
    alpha: number;
    width: number;
    life: number;
    max: number;
    speed: number;
};

export function NotFoundArt() {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const seed =
            window.location.pathname + window.location.search || "/404";
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

        let ink = readVar("--foreground", "0 0% 40%");
        let W = 0;
        let H = 0;
        let dpr = 1;
        let field: (x: number, y: number) => number = () => 0;
        let scale = 240;
        let turns = 2;
        let swirl = 0;
        let particles: Particle[] = [];
        let spawn = makeRandom(seed);

        const seedParticle = (rand: () => number, unit: number): Particle => {
            const roll = rand();
            const color = roll < 0.12 ? BLUE : roll < 0.3 ? GOLD : "ink";
            return {
                x: rand() * W,
                y: rand() * H,
                color,
                alpha:
                    color === "ink"
                        ? 0.05 + rand() * 0.07
                        : 0.09 + rand() * 0.09,
                width: 0.7 + rand() * (color === "ink" ? 1.4 : 2.2),
                life: 0,
                max: 50 + Math.floor(rand() * 130),
                speed: (0.8 + rand() * 1.1) * (unit / 720),
            };
        };

        const build = () => {
            const rect = wrap.getBoundingClientRect();
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = Math.max(1, Math.floor(rect.width));
            H = Math.max(1, Math.floor(rect.height));
            canvas.width = Math.floor(W * dpr);
            canvas.height = Math.floor(H * dpr);
            canvas.style.width = `${W}px`;
            canvas.style.height = `${H}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            ctx.lineCap = "round";

            const rand = makeRandom(seed);
            spawn = makeRandom(`${seed}::spawn`);
            field = makeField(rand);
            scale = 200 + rand() * 180;
            turns = 1.5 + rand() * 2.5;
            swirl = rand() * TAU;

            const count = Math.max(
                80,
                Math.min(260, Math.floor((W * H) / 9000)),
            );
            const unit = Math.min(W, H);
            particles = [];
            for (let i = 0; i < count; i++) {
                particles.push(seedParticle(rand, unit));
            }
        };

        const angleAt = (x: number, y: number) =>
            field(x / scale, y / scale) * TAU * turns + swirl;

        const step = (speedScale: number) => {
            const unit = Math.min(W, H);
            for (const p of particles) {
                const a = angleAt(p.x, p.y);
                const nx = p.x + Math.cos(a) * p.speed * speedScale;
                const ny = p.y + Math.sin(a) * p.speed * speedScale;
                ctx.strokeStyle = p.color === "ink" ? `hsl(${ink})` : p.color;
                ctx.globalAlpha = p.alpha;
                ctx.lineWidth = p.width;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(nx, ny);
                ctx.stroke();
                p.x = nx;
                p.y = ny;
                p.life++;
                if (
                    p.life > p.max ||
                    nx < -20 ||
                    nx > W + 20 ||
                    ny < -20 ||
                    ny > H + 20
                ) {
                    Object.assign(p, seedParticle(spawn, unit));
                }
            }
            ctx.globalAlpha = 1;
        };

        const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

        let raf = 0;
        let start = 0;
        const frame = (now: number) => {
            if (!start) start = now;
            const progress = Math.min(1, (now - start) / DURATION);
            step(easeOut(1 - progress));
            raf = progress < 1 ? requestAnimationFrame(frame) : 0;
        };

        const render = () => {
            build();
            if (reduced.matches) {
                // The finished piece, in one pass. No motion.
                for (let i = 0; i < 520; i++) step(1);
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

        // The animation is finite; pausing a hidden tab only saves the tail.
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
    }, []);

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

/**
 * The address, echoed. Client-only because the server never sees which URL
 * missed, and untrusted because a visitor writes it: decoded defensively,
 * stripped of control characters, clipped, and rendered as inert text so a
 * crafted path can neither run nor pose as a real link.
 */
export function RequestedPath() {
    const [path, setPath] = useState<string | null>(null);

    useEffect(() => {
        try {
            const raw = window.location.pathname + window.location.search;
            let p = raw;
            try {
                p = decodeURIComponent(raw);
            } catch {
                p = raw;
            }
            p = Array.from(p)
                .filter((ch) => {
                    const code = ch.charCodeAt(0);
                    return code > 0x1f && code !== 0x7f;
                })
                .join("");
            if (p.length > 96) p = `${p.slice(0, 95)}…`;
            setPath(p || "/");
        } catch {
            setPath(null);
        }
    }, []);

    if (!path) return null;
    return (
        <p className="mx-auto mt-6 max-w-full">
            <span className="sr-only">Requested address: </span>
            <code className="inline-block max-w-full truncate rounded border border-border bg-secondary px-2 py-1 align-middle font-mono text-xs text-foreground">
                {path}
            </code>
        </p>
    );
}
