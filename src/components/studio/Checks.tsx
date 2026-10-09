"use client";

import { useCallback, useState } from "react";
import type { ParamSpec } from "@/lib/params";
import { executeChecks, INITIAL_CHECKS, type Check, type CheckStatus } from "@/lib/checks";

export function Checks({
    html,
    seed,
    params,
    values,
    deps,
    onCompleted,
}: {
    html: string;
    seed: string;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    deps?: string[];
    onCompleted?: (passed: boolean) => void;
}) {
    const [checks, setChecks] = useState<Check[]>(INITIAL_CHECKS);
    const [running, setRunning] = useState(false);

    const run = useCallback(async () => {
        setRunning(true);
        try {
            const results = await executeChecks({
                html,
                seed,
                params,
                values,
                deps,
                onUpdate: setChecks,
            });
            const passed =
                results.length > 0 &&
                results.every((c) => c.status === "pass" || c.status === "warn");
            onCompleted?.(passed);
        } finally {
            setRunning(false);
        }
    }, [html, seed, params, values, deps, onCompleted]);

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
                        <CheckMark status={c.status} />
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

export function CheckMark({ status }: { status: CheckStatus }) {
    const style =
        status === "pass"
            ? "bg-success"
            : status === "fail"
              ? "bg-destructive"
              : status === "warn"
                ? "bg-warning"
                : status === "running"
                  ? "bg-warning animate-pulse"
                  : "bg-muted";
    return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style}`} aria-hidden />;
}
