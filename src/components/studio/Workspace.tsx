"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CodePane } from "./CodePane";
import { Frame } from "./Frame";
import { SeedGrid } from "./SeedGrid";
import { Checks } from "./Checks";
import { Cost } from "./Cost";
import { ParamsPanel } from "./ParamsPanel";
import { LibraryPicker } from "./LibraryPicker";
import { useDeps } from "./useDeps";
import { getKind } from "@/lib/runtimes";
import { saveDraft, randomSeed, type Draft } from "@/lib/draft";
import { downloadText } from "@/lib/project";
import { resolveParams, type ParamSpec } from "@/lib/params";
import { detectParams } from "@/lib/detect";
import { templateParamsFor } from "@/lib/templates";
import { Dice5 } from "lucide-react";

/**
 * Where an artist works. Code on the left, the piece on the right.
 *
 * Generative work is a loop: change a number, look, change it back. The studio
 * used to break that loop in half. The document was hidden behind an Export
 * button, so editing meant downloading a file, opening another editor, and
 * importing the result, and the preview only ever showed what you had already
 * finished deciding.
 *
 * So both halves are on screen at once and typing redraws. The seed is held
 * still while you type, because a piece that rerolls on every edit tells you
 * nothing about the edit.
 *
 * Everything below the preview is the rest of the job: the space rather than
 * one draw, what a collector may change, proof it behaves, and what it costs.
 * They sit under the piece rather than replacing it, so nothing you learn there
 * costs you sight of the work.
 *
 * All of it is local. The draft lives in this browser and nothing leaves it
 * until publish.
 */
type Tool = "seeds" | "params" | "libraries" | "checks" | "cost";

const TOOLS: { id: Tool; label: string }[] = [
    { id: "seeds", label: "Seeds" },
    { id: "params", label: "Parameters" },
    { id: "libraries", label: "Libraries" },
    { id: "checks", label: "Checks" },
    { id: "cost", label: "Cost" },
];

export function Workspace({ draft: initial }: { draft: Draft }) {
    const [draft, setDraft] = useState(initial);
    const [tool, setTool] = useState<Tool | null>(null);
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [saved, setSaved] = useState(true);
    // What the piece last threw. Cleared on every re-run, since the point of
    // editing is that the previous error may be the one you just fixed.
    const [error, setError] = useState<string | null>(null);

    // Libraries the document declares, resolved once for the whole workspace
    // and handed to every frame. A p5 sketch with no p5 draws nothing and says
    // nothing about why, so the failure is surfaced rather than swallowed.
    const { deps, loading: depsLoading, error: depsError } = useDeps(draft.html);
    const kind = getKind(draft.kindId);

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

    /**
     * Parameters the document declares, taken up as the artist writes them.
     *
     * The declaration is in the file, so it can arrive by paste, by drop, or by
     * typing, and reading it only on the import page meant the ordinary case,
     * pasting a generator into a blank draft, silently kept the kind's
     * defaults. If we tell people to declare parameters, this is where it has
     * to be read.
     *
     * **Applied only while the panel is untouched.** Untouched means it still
     * holds exactly the kind's defaults, so nothing the artist did is lost.
     * Once they have edited the panel it is theirs, and a declaration that
     * disagrees is offered rather than imposed: overwriting a control somebody
     * is in the middle of setting is the worst thing this could do.
     *
     * Runs on the debounced document, which is the same value that redraws the
     * frame, so it costs one parse per pause and never one per keystroke.
     */
    const declared = useMemo(() => detectParams(draft.html), [draft.html]);
    const [offered, setOffered] = useState<ParamSpec[] | null>(null);
    const [dismissed, setDismissed] = useState<string | null>(null);

    useEffect(() => {
        if (!declared) return;
        const next = JSON.stringify(declared.params);
        if (next === JSON.stringify(draft.params) || next === dismissed) {
            setOffered(null);
            return;
        }
        const untouched =
            JSON.stringify(draft.params) === JSON.stringify(templateParamsFor(draft.kindId));
        if (untouched) {
            setOffered(null);
            update({ params: declared.params });
        } else {
            setOffered(declared.params);
        }
    }, [declared, draft.params, draft.kindId, dismissed, update]);

    const setHtml = useCallback(
        (html: string) => {
            setError(null);
            update({ html });
        },
        [update],
    );

    return (
        // Full height, not a column of content. This is a workbench.
        <div className="flex h-[calc(100vh-5rem)] flex-col">
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-3">
                <div className="min-w-0">
                    <input
                        value={draft.name}
                        onChange={(e) => update({ name: e.target.value })}
                        className="w-full max-w-sm bg-transparent text-lg font-semibold tracking-tight outline-none"
                        aria-label="Draft name"
                    />
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {kind.label}
                        {" · "}
                        {saved ? "Saved in this browser" : "Saving…"}
                        {" · "}
                        <button
                            type="button"
                            className="underline hover:text-foreground"
                            onClick={() =>
                                downloadText(`${draft.name || "generator"}.html`, draft.html)
                            }
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

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <section
                    className="flex min-h-[40vh] flex-col border-b border-border lg:min-h-0 lg:w-1/2 lg:border-b-0 lg:border-r"
                    aria-label="Generator source"
                >
                    <CodePane value={draft.html} onChange={setHtml} onReplace={setHtml} />
                </section>

                <section
                    className="flex min-h-0 flex-col lg:w-1/2"
                    aria-label="Preview"
                >
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
                        <code
                            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                            title={draft.seed}
                        >
                            {draft.seed}
                        </code>
                        <button
                            type="button"
                            onClick={() => update({ seed: randomSeed() })}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                        >
                            <Dice5 size={12} aria-hidden />
                            New seed
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto p-3">
                        <div className="relative mx-auto aspect-square w-full max-w-[min(100%,70vh)] overflow-hidden rounded-lg border border-border">
                            {depsLoading ? (
                                <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                                    Loading {kind.deps.map((d) => d.label).join(", ") || "libraries"}…
                                </p>
                            ) : (
                                <Frame
                                    html={draft.html}
                                    seed={draft.seed}
                                    params={draft.params}
                                    values={values}
                                    deps={deps}
                                    onError={setError}
                                />
                            )}
                        </div>

                        {depsError && (
                            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                                {depsError}
                            </p>
                        )}

                        {error && (
                            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs">
                                {error}
                            </p>
                        )}

                        <nav className="mt-4 flex flex-wrap gap-1 border-b border-border">
                            {TOOLS.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => setTool(tool === t.id ? null : t.id)}
                                    className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                                        tool === t.id
                                            ? "border-alea-600 font-medium text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {t.label}
                                    {/* A count on the tab, so parameters taken
                                        up from the code are visible without
                                        opening the panel to find them. */}
                                    {t.id === "params" && draft.params.length > 0 && (
                                        <span className="ml-1.5 text-xs text-muted-foreground">
                                            {draft.params.length}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </nav>

                        <div className="pt-4">
                            {tool === null && (
                                <p className="text-xs text-muted-foreground">
                                    {/* The workspace is a column until lg, where the
                                        code sits above this. */}
                                    Edit the code and this redraws. The seed stays put until
                                    you change it.
                                </p>
                            )}

                            {tool === "seeds" && (
                                <SeedGrid
                                    deps={deps}
                                    html={draft.html}
                                    baseSeed={draft.seed}
                                    params={draft.params}
                                    values={values}
                                    onPick={(seed) => {
                                        update({ seed });
                                        setTool(null);
                                    }}
                                />
                            )}

                            {tool === "params" && (
                                <>
                                    {/* Offered, never applied over an edited
                                        panel. Shown in the panel it is about,
                                        so nothing appears over the code while
                                        somebody is typing in it. */}
                                    {offered && (
                                        <div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                            <p>
                                                Your code declares{" "}
                                                <strong>{offered.length}</strong>{" "}
                                                parameter{offered.length === 1 ? "" : "s"}:{" "}
                                                {offered.map((p) => p.label || p.id).join(", ")}.
                                                These are different from the ones below.
                                            </p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        update({ params: offered });
                                                        setOffered(null);
                                                    }}
                                                    className="rounded-md bg-alea-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-alea-700"
                                                >
                                                    Use the declaration
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setDismissed(JSON.stringify(offered));
                                                        setOffered(null);
                                                    }}
                                                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
                                                >
                                                    Keep mine
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <ParamsPanel
                                        specs={draft.params}
                                        values={resolveParams(draft.params, values)}
                                        onSpecsChange={(params) => update({ params })}
                                        onValuesChange={setValues}
                                    />
                                </>
                            )}

                            {tool === "libraries" && (
                                <LibraryPicker html={draft.html} onChange={setHtml} />
                            )}

                            {tool === "checks" && (
                                <Checks
                                    deps={deps}
                                    html={draft.html}
                                    seed={draft.seed}
                                    params={draft.params}
                                    values={values}
                                />
                            )}

                            {tool === "cost" && <Cost html={draft.html} />}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
