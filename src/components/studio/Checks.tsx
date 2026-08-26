"use client";

import { useCallback, useState } from "react";
import { resolveParams, type ParamSpec } from "@/lib/params";
import { ISOLATE_ORIGIN } from "@/lib/config";

/**
 * The checks a piece has to pass before it is worth publishing.
 *
 * Each one runs the piece for real and reports what happened. A check that
 * only passes good pieces is worth nothing: these have to catch a piece that
 * is doing the wrong thing, so the determinism check runs the same seed twice
 * in two fresh frames and compares what came out.
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

const CAPTURE_TIMEOUT = 8000;

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
     * Run the piece once in a detached frame and report what it did.
     *
     * The frame is thrown away afterwards. Reusing one would let a second run
     * inherit the first one's state, which is exactly the thing being tested.
     */
    /**
     * Run the piece once in a detached isolate frame and report what it did.
     *
     * The frame is thrown away afterwards. Reusing one would let a second run
     * inherit the first one's state, which is exactly the thing being tested.
     *
     * It goes through the same isolate the preview and a minted piece use, so
     * what this checks is what actually runs. A check against a second
     * implementation would only ever prove the second implementation works.
     */
    const runOnce = useCallback(
        (runSeed: string): Promise<{ digest: string | null; violations: string[]; ready: boolean }> =>
            new Promise((resolve) => {
                const frame = document.createElement("iframe");
                frame.setAttribute("sandbox", "allow-scripts");
                frame.setAttribute("referrerpolicy", "no-referrer");
                frame.style.cssText =
                    "position:fixed;left:-10000px;top:0;width:600px;height:600px;border:0";
                frame.src = ISOLATE_ORIGIN;

                const violations: string[] = [];
                let ready = false;
                let done = false;

                function finish(digest: string | null) {
                    if (done) return;
                    done = true;
                    window.removeEventListener("message", onMessage);
                    frame.remove();
                    resolve({ digest, violations, ready });
                }

                function onMessage(e: MessageEvent) {
                    if (e.source !== frame.contentWindow) return;
                    const d = e.data as {
                        type?: string;
                        kind?: string;
                        detail?: string;
                        digest?: string;
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
                            },
                            // Opaque origin: it cannot be named, so "*" is the
                            // only targetOrigin that reaches it. Only this
                            // frame gets it, we hold the window.
                            "*",
                        );
                    }
                    if (d?.type === "alea:violation") {
                        violations.push(`${d.kind}: ${d.detail}`);
                    }
                    if (d?.type === "alea:ready") {
                        ready = true;
                        finish(d.digest ?? null);
                    }
                }

                window.addEventListener("message", onMessage);
                document.body.appendChild(frame);

                // Browsers throttle hidden frames, so give a piece that never
                // signals a generous window before calling it.
                window.setTimeout(() => finish(null), CAPTURE_TIMEOUT + 2000);
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
        set("determinism", {
            status: same ? "pass" : "fail",
            note: same
                ? "Same seed, same picture, every time."
                : bothCaptured
                  ? "The same seed drew two different pictures. Something in your piece is using randomness that is not the seed."
                  : "One of the runs never finished, so there was nothing to compare.",
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
                : "Never called $alea.ready(). Without it we capture on a timer and might catch your piece half-drawn.",
        });

        setRunning(false);
    }, [runOnce, seed, set]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    Checks run against the seed you have chosen.
                </p>
                <button
                    type="button"
                    onClick={() => void run()}
                    disabled={running}
                    className="rounded-md bg-alea-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
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
