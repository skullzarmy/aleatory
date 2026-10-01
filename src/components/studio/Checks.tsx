"use client";

import { useCallback, useState } from "react";
import { resolveParams, type ParamSpec } from "@/lib/params";
import { ISOLATE_ORIGIN } from "@/lib/config";

/**
 * The checks a piece has to pass before it is worth publishing. Each runs the
 * piece for real: determinism means the same seed drawn twice in two fresh
 * frames, compared.
 */
type Status = "idle" | "running" | "pass" | "fail";

interface Check {
    id: string;
    label: string;
    detail: string;
    status: Status;
    note?: string;
}

const INITIAL: Check[] = [
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
];

// Matches isolate's own default fallback (isolate/index.html, CFG.timeout ||
// 20000) — this component never passes an explicit timeout, so that default
// is what actually runs. This file's own +2000 margin below is what keeps
// this outer timeout from giving up before the isolate's internal one would
// have produced a real (if auto-captured) result.
const CAPTURE_TIMEOUT = 20_000;

/**
 * How much of two captures actually differs, in pixels.
 *
 * Chrome defers 2D canvas drawing and rasterises it at timing-dependent
 * moments, so two determinism runs of one genuinely deterministic piece can
 * differ by a handful of pixels for reasons that have nothing to do with the
 * piece's own code — this has been measured on WebGL/shader pieces
 * specifically. A flat pass/fail on digest equality cannot tell that apart
 * from a real bug, so this reports the actual magnitude and leaves the
 * judgment to whoever is looking at it.
 *
 * A channel has to differ by more than a few levels to count — anti-aliasing
 * and compression rounding differ by one or two levels on pixels nothing
 * drew differently, and counting those would make every piece report noise.
 */
async function pixelDiffPercent(a: string, b: string): Promise<number | null> {
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

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image failed to decode"));
        img.src = dataUrl;
    });
}

export function Checks({
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
}) {
    const [checks, setChecks] = useState<Check[]>(INITIAL);
    const [running, setRunning] = useState(false);

    const set = useCallback((id: string, patch: Partial<Check>) => {
        setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    }, []);

    /**
     * Run the piece once in a detached isolate frame and report what it did.
     * The frame is thrown away afterwards, or a second run would inherit the
     * first one's state, which is the thing being tested.
     *
     * The same isolate the preview and a minted piece use, so this checks what
     * actually runs.
     */
    const runOnce = useCallback(
        (
            runSeed: string,
        ): Promise<{
            digest: string | null;
            image: string | null;
            violations: string[];
            ready: boolean;
            autoCaptured: boolean;
        }> =>
            new Promise((resolve) => {
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
                    resolve({ digest, image, violations, ready, autoCaptured });
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
                                seed: runSeed,
                                params: resolveParams(params, values ?? {}),
                                paramsSchema: params,
                                deps: deps ?? [],
                                // The pixels, not just the digest: a mismatch
                                // is reported by how much actually differs,
                                // which needs the images to compare.
                                wantImage: true,
                            },
                            // An opaque origin cannot be named, so "*" is the
                            // only targetOrigin that reaches it.
                            "*",
                        );
                    }
                    if (d?.type === "alea:violation") {
                        violations.push(`${d.kind}: ${d.detail}`);
                    }
                    if (d?.type === "alea:ready") {
                        // A message did arrive, but the isolate's own fallback
                        // timer can be what sent it — that is not the piece
                        // saying it is done, and this check exists to tell
                        // the difference.
                        ready = !d.autoCaptured;
                        autoCaptured = Boolean(d.autoCaptured);
                        finish(d.digest ?? null, d.image ?? null);
                    }
                }

                window.addEventListener("message", onMessage);
                document.body.appendChild(frame);

                // Browsers throttle hidden frames, so a piece that never signals
                // gets a generous window.
                window.setTimeout(() => finish(null, null), CAPTURE_TIMEOUT + 2000);
            }),
        [html, params, values, deps],
    );

    const run = useCallback(async () => {
        setRunning(true);
        setChecks(INITIAL.map((c) => ({ ...c, status: "running" as Status })));

        const first = await runOnce(seed);
        const second = await runOnce(seed);

        const bothCaptured = first.digest !== null && second.digest !== null;
        const same = bothCaptured && first.digest === second.digest;
        let diffPercent: number | null = null;
        if (bothCaptured && !same && first.image && second.image) {
            diffPercent = await pixelDiffPercent(first.image, second.image);
        }
        set("determinism", {
            status: same ? "pass" : "fail",
            note: same
                ? "Same seed, same picture, every time."
                : !bothCaptured
                  ? "One of the runs never finished, so there was nothing to compare."
                  : diffPercent === null
                    ? "The same seed drew two different pictures, and the pixels could not be compared directly."
                    : diffPercent < 0.1
                      ? `${diffPercent.toFixed(2)}% of pixels differ — small enough that this can be a browser timing quirk rather than a bug. Chrome's canvas rasterisation timing varies run to run; compare the two captures yourself before assuming your code is wrong.`
                      : `${diffPercent.toFixed(2)}% of pixels differ. Something in your piece is likely using randomness that is not the seed.`,
        });

        const net = [...first.violations, ...second.violations].filter((v) =>
            v.startsWith("network"),
        );
        set("network", {
            status: net.length === 0 ? "pass" : "fail",
            note:
                net.length === 0
                    ? "Nothing was requested."
                    : `Attempted: ${net.slice(0, 3).join("; ")}`,
        });

        set("capture", {
            status: first.ready ? "pass" : "fail",
            note: first.ready
                ? "Called $alea.ready()."
                : first.autoCaptured
                  ? "Never called $alea.ready() — captured on a timer instead, which might have caught your piece half-drawn."
                  : "Never called $alea.ready(), and the run never finished at all.",
        });

        setRunning(false);
    }, [runOnce, seed, set]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    Checks run against the seed you have chosen.
                </p>
                <button
                    type="button"
                    onClick={() => void run()}
                    disabled={running}
                    className="shrink-0 rounded-md bg-alea-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {running ? "Running" : "Run checks"}
                </button>
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border">
                {checks.map((c) => (
                    <li key={c.id} className="flex gap-3 px-4 py-3">
                        <Mark status={c.status} />
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">{c.label}</span>
                            <span className="block text-xs text-muted-foreground">
                                {c.note ?? c.detail}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Mark({ status }: { status: Status }) {
    const style =
        status === "pass"
            ? "bg-success"
            : status === "fail"
              ? "bg-destructive"
              : status === "running"
                ? "bg-warning animate-pulse"
                : "bg-muted";
    return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style}`} aria-hidden />;
}
