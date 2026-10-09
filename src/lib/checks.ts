import { resolveParams, type ParamSpec } from "@/lib/params";
import { ISOLATE_ORIGIN } from "@/lib/config";

export type CheckStatus = "idle" | "running" | "pass" | "warn" | "fail";

export interface Check {
    id: "determinism" | "network" | "capture" | "image" | "performance";
    label: string;
    detail: string;
    status: CheckStatus;
    note?: string;
}

export const INITIAL_CHECKS: Check[] = [
    {
        id: "determinism",
        label: "Same seed, same piece",
        detail: "Draws the same seed twice and checks you get the same picture.",
        status: "idle",
    },
    {
        id: "network",
        label: "No network",
        detail: "Your piece should not try to load anything from the internet.",
        status: "idle",
    },
    {
        id: "capture",
        label: "Says when it is finished",
        detail: "Calls $alea.ready() so we know when to capture the image.",
        status: "idle",
    },
    {
        id: "image",
        label: "Working image",
        detail: "Checks that your piece produces a visible picture and not an empty or all-black canvas.",
        status: "idle",
    },
    {
        id: "performance",
        label: "How long it takes to draw",
        detail: "Times a real run on this screen. A denser display draws more pixels for the same size on screen, which can make a piece that felt instant elsewhere noticeably slower here.",
        status: "idle",
    },
];

const SLOW_MS = 4_000;
const CAPTURE_TIMEOUT = 20_000;

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image failed to decode"));
        img.src = dataUrl;
    });
}

/**
 * Check whether an image is completely black or blank.
 *
 * Samples down to at most 100x100 pixels. Returns true when zero pixels
 * have any brightness or opacity.
 */
export async function isBlankOrSolidBlack(dataUrl: string): Promise<boolean> {
    try {
        const img = await loadImage(dataUrl);
        const canvas = document.createElement("canvas");
        const w = Math.min(img.width || 100, 100);
        const h = Math.min(img.height || 100, 100);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return false;
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a > 10 && (r > 10 || g > 10 || b > 10)) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

export async function pixelDiffPercent(a: string, b: string): Promise<number | null> {
    try {
        const [imgA, imgB] = await Promise.all([loadImage(a), loadImage(b)]);
        if (imgA.width !== imgB.width || imgA.height !== imgB.height) return null;

        const canvas = document.createElement("canvas");
        canvas.width = imgA.width;
        canvas.height = imgA.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        ctx.drawImage(imgA, 0, 0);
        const dataA = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgB, 0, 0);
        const dataB = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        const TOLERANCE = 6;
        let differing = 0;
        const pixels = dataA.length / 4;
        for (let p = 0; p < pixels; p++) {
            const i = p * 4;
            if (
                Math.abs(dataA[i] - dataB[i]) > TOLERANCE ||
                Math.abs(dataA[i + 1] - dataB[i + 1]) > TOLERANCE ||
                Math.abs(dataA[i + 2] - dataB[i + 2]) > TOLERANCE ||
                Math.abs(dataA[i + 3] - dataB[i + 3]) > TOLERANCE
            ) {
                differing++;
            }
        }
        return (differing / pixels) * 100;
    } catch {
        return null;
    }
}

export interface RunReport {
    digest: string | null;
    image: string | null;
    violations: string[];
    ready: boolean;
    autoCaptured: boolean;
    ms: number;
}

export function runOnce({
    html,
    seed,
    params,
    values,
    deps,
}: {
    html: string;
    seed: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    deps?: string[];
}): Promise<RunReport> {
    return new Promise((resolve) => {
        const started = performance.now();
        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.style.cssText =
            "position:fixed;left:-10000px;top:0;width:600px;height:600px;border:0";
        frame.src = ISOLATE_ORIGIN;

        const violations: string[] = [];
        let ready = false;
        let autoCaptured = false;
        let done = false;

        function finish(digest: string | null, image: string | null) {
            if (done) return;
            done = true;
            window.removeEventListener("message", onMessage);
            frame.remove();
            resolve({
                digest,
                image,
                violations,
                ready,
                autoCaptured,
                ms: performance.now() - started,
            });
        }

        function onMessage(e: MessageEvent) {
            if (e.source !== frame.contentWindow) return;
            const d = e.data as {
                type?: string;
                kind?: string;
                detail?: string;
                digest?: string;
                image?: string | null;
                autoCaptured?: boolean;
            };
            if (d?.type === "alea:hello") {
                frame.contentWindow?.postMessage(
                    {
                        type: "alea:run",
                        code: html,
                        seed,
                        params: resolveParams(params, values ?? {}),
                        paramsSchema: params,
                        deps: deps ?? [],
                        wantImage: true,
                    },
                    "*",
                );
            }
            if (d?.type === "alea:violation") {
                violations.push(`${d.kind}: ${d.detail}`);
            }
            if (d?.type === "alea:ready") {
                ready = !d.autoCaptured;
                autoCaptured = Boolean(d.autoCaptured);
                finish(d.digest ?? null, d.image ?? null);
            }
        }

        window.addEventListener("message", onMessage);
        document.body.appendChild(frame);
        window.setTimeout(() => finish(null, null), CAPTURE_TIMEOUT + 2000);
    });
}

export async function executeChecks({
    html,
    seed,
    params,
    values,
    deps,
    onUpdate,
}: {
    html: string;
    seed: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    deps?: string[];
    onUpdate?: (checks: Check[]) => void;
}): Promise<Check[]> {
    let current: Check[] = INITIAL_CHECKS.map((c) => ({ ...c, status: "running" as CheckStatus }));
    onUpdate?.(current);

    function patch(id: Check["id"], update: Partial<Check>) {
        current = current.map((c) => (c.id === id ? { ...c, ...update } : c));
        onUpdate?.(current);
    }

    const first = await runOnce({ html, seed, params, values, deps });
    const second = await runOnce({ html, seed, params, values, deps });

    const bothCaptured = first.digest !== null && second.digest !== null;
    const same = bothCaptured && first.digest === second.digest;
    let diffPercent: number | null = null;
    if (bothCaptured && !same && first.image && second.image) {
        diffPercent = await pixelDiffPercent(first.image, second.image);
    }

    const determinismStatus: CheckStatus = same
        ? "pass"
        : diffPercent !== null && diffPercent < 0.1
          ? "warn"
          : "fail";

    patch("determinism", {
        status: determinismStatus,
        note: same
            ? "Same seed, same picture, every time."
            : !bothCaptured
              ? "One of the runs never finished, so there was nothing to compare."
              : diffPercent === null
                ? "The same seed drew two different pictures, and the pixels could not be compared directly."
                : diffPercent < 0.1
                  ? `${diffPercent.toFixed(2)}% of pixels differ. Small enough to be browser rasterization timing rather than a bug.`
                  : `${diffPercent.toFixed(2)}% of pixels differ. Something in your piece is likely using randomness that is not the seed.`,
    });

    const net = [...first.violations, ...second.violations].filter((v) => v.startsWith("network"));
    patch("network", {
        status: net.length === 0 ? "pass" : "fail",
        note:
            net.length === 0
                ? "Nothing was requested."
                : `Attempted: ${net.slice(0, 3).join("; ")}`,
    });

    patch("capture", {
        status: first.ready ? "pass" : "fail",
        note: first.ready
            ? "Called $alea.ready()."
            : first.autoCaptured
              ? "Never called $alea.ready(). Captured on a timer instead, which can catch the piece half-drawn."
              : "Never called $alea.ready(), and the run never finished.",
    });

    const isBlank = !first.image || (await isBlankOrSolidBlack(first.image));
    patch("image", {
        status: isBlank ? "fail" : "pass",
        note: isBlank
            ? "The captured canvas is completely black or empty. If using WebGL or Three.js, enable preserveDrawingBuffer: true. If drawing asynchronously, call $alea.ready() after rendering."
            : "Produced a visible picture.",
    });

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const seconds = (first.ms / 1000).toFixed(1);
    patch("performance", {
        status: !first.ready ? "fail" : first.ms > SLOW_MS ? "warn" : "pass",
        note: !first.ready
            ? "Never finished, so there is nothing to time."
            : first.ms > SLOW_MS
              ? `${seconds}s to draw at ${dpr}x pixel density. Slow enough that visitors on dense screens may notice.`
              : `${seconds}s to draw at ${dpr}x pixel density.`,
    });

    return current;
}

export function hasFailingChecks(checks: Check[]): boolean {
    return checks.some((c) => c.status === "fail");
}

export function allChecksPassed(checks: Check[]): boolean {
    return checks.length > 0 && checks.every((c) => c.status === "pass" || c.status === "warn");
}
