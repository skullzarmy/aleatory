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
import { resolveParams } from "@/lib/params";
import { detectParams, withParams } from "@/lib/detect";
import { ArrowRight, Dice5, Download } from "lucide-react";

/**
 * Where an artist works. Code on the left, the piece on the right.
 *
 * Generative work is a loop: change a number, look, change it back. So both
 * halves are on screen at once and typing redraws. The seed is held still
 * while you type, because a piece that rerolls on every edit tells you nothing
 * about the edit.
 *
 * Everything below the preview is the rest of the job: the space rather than
 * one draw, what a collector may change, proof it behaves, and what it costs.
 * They sit under the piece rather than replacing it, so nothing you learn there
 * costs you sight of the work.
 *
 * All of it is local. The draft lives in this browser and nothing leaves it
 * until publish.
 */
type Tool = "code" | "preview" | "seeds" | "params" | "libraries" | "checks" | "cost";

/** `code` is offered only below lg, where it has no column of its own. */
const TOOLS: { id: Tool; label: string }[] = [
    { id: "code", label: "Code" },
    { id: "preview", label: "Preview" },
    { id: "seeds", label: "Seeds" },
    { id: "params", label: "Parameters" },
    { id: "libraries", label: "Libraries" },
    { id: "checks", label: "Checks" },
    { id: "cost", label: "Cost" },
];

export function Workspace({ draft: initial }: { draft: Draft }) {
    const [draft, setDraft] = useState(initial);
    const [tool, setTool] = useState<Tool>("preview");
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

    // Code has its own column from lg up, so the tab is offered only below it.
    // Widening the window while that tab is open would otherwise leave the
    // panel showing nothing, since the pane it selects is hidden at that size.
    useEffect(() => {
        const wide = window.matchMedia("(min-width: 1024px)");
        const snap = () => setTool((t) => (wide.matches && t === "code" ? "preview" : t));
        snap();
        wide.addEventListener("change", snap);
        return () => wide.removeEventListener("change", snap);
    }, []);

    const update = useCallback((patch: Partial<Draft>) => {
        setDraft((d) => ({ ...d, ...patch }));
    }, []);

    /**
     * The declared parameters, read from the document every time it changes.
     *
     * Derived, never stored. The panel below writes them back into the file
     * with `withParams`, exactly as the library picker writes its meta tags,
     * so there is one source of truth and it is the artist's own document.
     * ALEATORY-001 says a generator declares its own parameters; keeping a
     * second copy beside it is what made a paste read nothing and what would
     * make an export disagree with the panel.
     */
    const params = useMemo(() => detectParams(draft.html)?.params ?? [], [draft.html]);

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
                    </p>
                </div>

                {/* Export sits beside publish because it is the other way a
                    draft leaves this browser, and the one that matters when
                    publishing is not what you want yet. It spent a while as a
                    text link inside the subtitle, which read as a footnote
                    rather than as the thing we tell people to do. */}
                <div className="flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={() =>
                            downloadText(`${draft.name || "generator"}.html`, draft.html)
                        }
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
                    >
                        <Download size={14} aria-hidden />
                        Export
                    </button>

                    {/* An arrow, and trailing, because this button does not
                        publish anything — it opens the flow that does. Upload
                        would have been the pair to Export's download, but the
                        code pane already spends it on opening a file, and two
                        meanings for one glyph in one workspace is worse than
                        no glyph at all. */}
                    <Link
                        href={`/studio/${draft.id}/publish`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                    >
                        Publish
                        <ArrowRight size={14} aria-hidden />
                    </Link>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                {/* The code keeps its own column on a wide screen. On a narrow
                    one it is a tab like everything else, because stacking a
                    code editor above a preview above a panel gives all three
                    too little and makes the page a scroll. */}
                <section
                    className="hidden min-h-0 flex-col border-border lg:flex lg:w-1/2 lg:border-r"
                    aria-label="Generator source"
                >
                    <CodePane value={draft.html} onChange={setHtml} onReplace={setHtml} />
                </section>

                <section className="flex min-h-0 flex-1 flex-col lg:w-1/2" aria-label="Workspace">
                    {/* One row of tabs owning one area. The preview used to be
                        pinned above them, which left every panel a strip at the
                        bottom of the column and put the parameters below the
                        fold on a laptop. A panel that needs to show the work
                        renders it: the seed grid does, checks does, and the
                        parameters panel does, because tuning a control you
                        cannot see the effect of is the one thing it must not
                        ask of anybody. */}
                    <nav
                        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2"
                        aria-label="Workspace panels"
                    >
                        {TOOLS.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setTool(t.id)}
                                aria-current={tool === t.id ? "true" : undefined}
                                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                                    t.id === "code" ? "lg:hidden " : ""
                                }${
                                    tool === t.id
                                        ? "border-alea-600 font-medium text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {t.label}
                                {t.id === "params" && params.length > 0 && (
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                        {params.length}
                                    </span>
                                )}
                            </button>
                        ))}
                    </nav>

                    {/* The seed belongs to whatever is drawing, so it sits with
                        the panels that draw and stays out of the way of the
                        ones that do not. */}
                    {(tool === "preview" || tool === "params") && (
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
                    )}

                    {tool === "code" ? (
                        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
                            <CodePane value={draft.html} onChange={setHtml} onReplace={setHtml} />
                        </div>
                    ) : (
                        <div className="min-h-0 flex-1 overflow-auto p-3">
                            {(tool === "preview" || tool === "params") && (
                                <div
                                    className={`relative mx-auto aspect-square w-full overflow-hidden rounded-lg border border-border ${
                                        tool === "params"
                                            ? "max-w-[min(100%,38vh)]"
                                            : "max-w-[min(100%,70vh)]"
                                    }`}
                                >
                                    {depsLoading ? (
                                        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                                            Loading{" "}
                                            {kind.deps.map((d) => d.label).join(", ") ||
                                                "libraries"}
                                            …
                                        </p>
                                    ) : (
                                        <Frame
                                            html={draft.html}
                                            seed={draft.seed}
                                            params={params}
                                            values={values}
                                            deps={deps}
                                            onError={setError}
                                        />
                                    )}
                                </div>
                            )}

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

                            {tool === "preview" && (
                                <p className="mt-4 text-xs text-muted-foreground">
                                    Edit the code and this redraws. The seed stays put until you
                                    change it.
                                </p>
                            )}

                            {tool === "seeds" && (
                                <SeedGrid
                                    deps={deps}
                                    html={draft.html}
                                    baseSeed={draft.seed}
                                    params={params}
                                    values={values}
                                    onPick={(seed) => {
                                        update({ seed });
                                        setTool("preview");
                                    }}
                                />
                            )}

                            {tool === "params" && (
                                <div className="mt-4">
                                    <ParamsPanel
                                        specs={params}
                                        values={resolveParams(params, values)}
                                        onSpecsChange={(next) =>
                                            setHtml(withParams(draft.html, next))
                                        }
                                        onValuesChange={setValues}
                                    />
                                </div>
                            )}

                            {tool === "libraries" && (
                                <LibraryPicker html={draft.html} onChange={setHtml} />
                            )}

                            {tool === "checks" && (
                                <Checks
                                    deps={deps}
                                    html={draft.html}
                                    seed={draft.seed}
                                    params={params}
                                    values={values}
                                />
                            )}

                            {tool === "cost" && <Cost html={draft.html} />}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
