"use client";

import { useCallback, useEffect, useState } from "react";
import { X, ArrowRight, RotateCw, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Draft } from "@/lib/draft";
import type { ParamSpec } from "@/lib/params";
import { executeChecks, INITIAL_CHECKS, type Check } from "@/lib/checks";
import { convertIpfsToGatewayUrl } from "@/utils/ipfs";
import { CheckMark } from "./Checks";

export function PreflightModal({
    open,
    draft,
    params,
    values,
    deps,
    onClose,
    onProceed,
}: {
    open: boolean;
    draft: Draft;
    params: ParamSpec[];
    values?: Record<string, unknown>;
    deps?: string[];
    onClose: () => void;
    onProceed: () => void;
}) {
    const [checks, setChecks] = useState<Check[]>(INITIAL_CHECKS);
    const [running, setRunning] = useState(false);
    const [hasRun, setHasRun] = useState(false);
    const [coverConfirmed, setCoverConfirmed] = useState(false);

    const run = useCallback(async () => {
        setRunning(true);
        try {
            await executeChecks({
                html: draft.html,
                seed: draft.seed,
                params,
                values,
                deps,
                onUpdate: setChecks,
            });
            setHasRun(true);
        } finally {
            setRunning(false);
        }
    }, [draft.html, draft.seed, params, values, deps]);

    useEffect(() => {
        if (!open) {
            setChecks(INITIAL_CHECKS);
            setHasRun(false);
            setRunning(false);
            setCoverConfirmed(false);
            return;
        }
        void run();
    }, [open, run]);

    const hasFailed = checks.some((c) => c.status === "fail");
    const hasCover = Boolean(draft.cover?.uri);
    const hasPassed =
        hasRun &&
        !running &&
        !hasFailed &&
        hasCover &&
        checks.every((c) => c.status === "pass" || c.status === "warn");

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preflight-title"
        >
            <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 id="preflight-title" className="text-lg font-semibold tracking-tight">
                            Pre-flight checks
                        </h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Every generator must pass conformance checks before it can be published.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={running}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        aria-label="Close"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

                <ul className="divide-y divide-border rounded-lg border border-border">
                    {checks.map((c) => (
                        <li key={c.id} className="flex gap-3 px-4 py-2.5">
                            <CheckMark status={c.status} />
                            <div className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">{c.label}</span>
                                <span className="block text-xs text-muted-foreground">
                                    {c.note ?? c.detail}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>

                {draft.cover ? (
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-2.5">
                        <img
                            src={convertIpfsToGatewayUrl(draft.cover.thumbUri || draft.cover.uri)}
                            alt="Cover thumbnail"
                            className="h-14 w-14 rounded border border-border object-cover"
                        />
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground">Cover image set</p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                                Seed: {draft.cover.seed}
                            </p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                                {draft.cover.uri}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                        <div>
                            <p className="font-semibold">No cover image set</p>
                            <p className="mt-0.5 text-muted-foreground">
                                Select and pin a cover image in the Details tab before publishing.
                            </p>
                        </div>
                    </div>
                )}

                {hasFailed && !running && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                        <div>
                            <p className="font-semibold">Pre-flight checks failed</p>
                            <p className="mt-0.5 text-muted-foreground">
                                A generator with failing checks cannot be published. Fix the
                                highlighted issues in your code and try again.
                            </p>
                        </div>
                    </div>
                )}

                {hasPassed && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-success/40 bg-success/10 p-3 text-xs text-success">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
                        <div>
                            <p className="font-semibold">All checks passed</p>
                            <p className="mt-0.5 text-muted-foreground">
                                Your generator is deterministic, isolated, and produces valid
                                output.
                            </p>
                        </div>
                    </div>
                )}

                <aside className="rounded-lg border border-alea-600/30 bg-alea-600/5 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Test on Shadownet first</p>
                    <p className="mt-0.5 leading-relaxed">
                        Start development on{" "}
                        <a
                            href="https://shadownet.aleatory.art"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline hover:text-foreground"
                        >
                            shadownet.aleatory.art
                        </a>{" "}
                        and test fully there through the minting process before deploying to
                        mainnet. Shadownet tez is free and can be requested at{" "}
                        <a
                            href="https://faucet.shadownet.teztnets.com/"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline hover:text-foreground"
                        >
                            https://faucet.shadownet.teztnets.com/
                        </a>
                        .
                    </p>
                </aside>

                <label
                    className={`flex items-start gap-2.5 rounded-lg border border-border bg-card p-3 text-xs ${
                        !hasCover ? "cursor-not-allowed opacity-50" : "cursor-pointer select-none"
                    }`}
                >
                    <input
                        type="checkbox"
                        checked={coverConfirmed}
                        disabled={!hasCover}
                        onChange={(e) => setCoverConfirmed(e.target.checked)}
                        className="mt-0.5 rounded border-border accent-alea-600"
                    />
                    <span className="font-medium leading-relaxed text-foreground">
                        I have checked my cover image and understand this cannot be changed later.
                    </span>
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                        type="button"
                        onClick={() => void run()}
                        disabled={running}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    >
                        <RotateCw size={13} className={running ? "animate-spin" : ""} aria-hidden />
                        {running ? "Checking…" : "Run again"}
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
                        >
                            Back to editor
                        </button>
                        <button
                            type="button"
                            onClick={onProceed}
                            disabled={!hasPassed || running || !coverConfirmed}
                            className="inline-flex items-center gap-1.5 rounded-md bg-alea-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-alea-700 disabled:opacity-50"
                        >
                            Continue to publish
                            <ArrowRight size={13} aria-hidden />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
