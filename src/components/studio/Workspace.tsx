"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Frame } from "./Frame";
import { SeedGrid } from "./SeedGrid";
import { Checks } from "./Checks";
import { Cost } from "./Cost";
import { ParamsPanel } from "./ParamsPanel";
import { useDeps } from "./useDeps";
import { getKind } from "@/lib/runtimes";
import { saveDraft, randomSeed, type Draft } from "@/lib/draft";
import { downloadText } from "@/lib/project";
import { resolveParams } from "@/lib/params";

/**
 * Where an artist works.
 *
 * Five things, and they are the five things a generative artist does before
 * publishing: look at one piece, look at the space, decide what a collector
 * may change, prove the piece behaves, and find out what it costs.
 *
 * Everything is local. The draft lives in this browser and nothing leaves it
 * until publish.
 */
type Tab = "piece" | "seeds" | "params" | "checks" | "cost";

const TABS: { id: Tab; label: string }[] = [
    { id: "piece", label: "Piece" },
    { id: "seeds", label: "Seeds" },
    { id: "params", label: "Parameters" },
    { id: "checks", label: "Checks" },
    { id: "cost", label: "Cost" },
];

export function Workspace({ draft: initial }: { draft: Draft }) {
    const [draft, setDraft] = useState(initial);
    const [tab, setTab] = useState<Tab>("piece");
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [saved, setSaved] = useState(true);

    // p5 and anything like it is inlined into the document before the piece
    // runs. Until it resolves there is no point drawing: a p5 sketch with no p5
    // is a blank frame, and a blank frame that explains nothing is worse than
    // an error.
    const { deps, loading: depsLoading, error: depsError } = useDeps(draft.kindId);
    const kind = getKind(draft.kindId);
    const depsReady = !depsLoading && !depsError;

    // Autosave. A draft that only survives an explicit save is a draft that
    // gets lost.
    useEffect(() => {
        setSaved(false);
        const t = setTimeout(() => {
            void saveDraft(draft).then(() => setSaved(true));
        }, 600);
        return () => clearTimeout(t);
    }, [draft]);

    const update = useCallback((patch: Partial<Draft>) => {
        setDraft((d) => ({ ...d, ...patch }));
    }, []);

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                    <input
                        value={draft.name}
                        onChange={(e) => update({ name: e.target.value })}
                        className="w-full max-w-sm bg-transparent text-xl font-semibold tracking-tight outline-none"
                        aria-label="Draft name"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                        {saved ? "Saved in this browser" : "Saving…"}
                        {" · "}
                        <button
                            type="button"
                            className="underline hover:text-foreground"
                            onClick={() => downloadText(`${draft.name || "generator"}.html`, draft.html)}
                        >
                            Export
                        </button>
                    </p>
                </div>

                <Link
                    href={`/studio/${draft.id}/publish`}
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Publish
                </Link>
            </header>

            <nav className="mb-6 flex gap-1 border-b border-border">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                            tab === t.id
                                ? "border-alea-600 font-medium text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            {depsError && (
                <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {kind.label} needs {kind.deps.map((d) => d.label).join(", ")}, and it could
                    not be loaded: {depsError}
                </p>
            )}

            {tab === "piece" && (
                <div className="space-y-4">
                    <div className="relative aspect-square max-h-[70vh] overflow-hidden rounded-lg border border-border">
                        {depsReady ? (
                            <Frame
                                html={draft.html}
                                seed={draft.seed}
                                params={draft.params}
                                values={values}
                                deps={deps}
                            />
                        ) : (
                            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                                {depsLoading
                                    ? `Loading ${kind.deps.map((d) => d.label).join(", ")}…`
                                    : "Nothing to draw."}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
                            {draft.seed}
                        </code>
                        <button
                            type="button"
                            onClick={() => update({ seed: randomSeed() })}
                            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                        >
                            New seed
                        </button>
                    </div>
                </div>
            )}

            {tab === "seeds" &&
                (depsReady ? (
                    <SeedGrid
                        html={draft.html}
                        baseSeed={draft.seed}
                        params={draft.params}
                        values={values}
                        deps={deps}
                        onPick={(seed) => {
                            update({ seed });
                            setTab("piece");
                        }}
                    />
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {depsLoading ? "Loading libraries…" : "Nothing to draw."}
                    </p>
                ))}

            {tab === "params" && (
                <ParamsPanel
                    specs={draft.params}
                    values={resolveParams(draft.params, values)}
                    onSpecsChange={(params) => update({ params })}
                    onValuesChange={setValues}
                />
            )}

            {tab === "checks" && (
                <Checks
                    html={draft.html}
                    seed={draft.seed}
                    params={draft.params}
                    values={values}
                    deps={deps}
                />
            )}

            {tab === "cost" && <Cost html={draft.html} />}
        </div>
    );
}
