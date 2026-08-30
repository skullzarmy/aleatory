"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getKind, RUNTIME_KINDS } from "@/lib/runtimes";
import { templateFor, templateParamsFor } from "@/lib/templates";
import { packageFromFile, packageFromHtml } from "@/lib/project";
import { detectKind, detectParams } from "@/lib/detect";
import { newDraft, saveDraft } from "@/lib/draft";

/**
 * Loading a generator.
 *
 * Three ways in, because artists arrive from three places: some want a running
 * piece to change, some have a folder of work already, some want an empty file.
 *
 * A `.zip` is inlined into a single document here rather than at publish, so
 * what runs in the studio is byte for byte what goes on chain. A preview built
 * from loose files and a publish built from a bundle are two different pieces.
 */
export default function NewGeneratorPage() {
    const router = useRouter();
    const fileRef = useRef<HTMLInputElement>(null);
    const [kindId, setKindId] = useState(RUNTIME_KINDS[0].kindId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // What an uploaded file said about itself, shown rather than applied
    // quietly. A detected kind that is wrong should be visible and editable,
    // not discovered later by an artist wondering why the panel looks odd.
    const [detected, setDetected] = useState<string | null>(null);

    async function start(name: string, html: string, params = templateParamsFor(kindId)) {
        setBusy(true);
        setError(null);
        try {
            const draft = newDraft(name, kindId, packageFromHtml(html), params);
            await saveDraft(draft);
            router.push(`/studio/${draft.id}`);
        } catch (e) {
            setBusy(false);
            setError(e instanceof Error ? e.message : "Could not open that.");
        }
    }

    async function fromFile(file: File) {
        setBusy(true);
        setError(null);
        try {
            const project = await packageFromFile(file);

            // The file already knows what it is. Asking the artist to pick the
            // kind again on the way back in is asking them to remember a
            // choice from the way out, and to be punished for misremembering.
            const guess = detectKind(project.html);
            setKindId(guess.kindId);

            const detectedParams = detectParams(project.html);
            const params = detectedParams?.params ?? templateParamsFor(guess.kindId);

            setDetected(
                detectedParams
                    ? [
                          `${guess.because}, and ${detectedParams.because} (${detectedParams.params.length} parameter${detectedParams.params.length === 1 ? "" : "s"})`,
                          // What reading the declaration cost. An artist who
                          // declared seven and is given five cannot see the
                          // two that went missing unless we say so.
                          ...detectedParams.notes,
                      ].join(". ")
                    : guess.because,
            );

            const draft = newDraft(
                file.name.replace(/\.(html?|zip)$/i, ""),
                guess.kindId,
                project,
                params,
            );
            await saveDraft(draft);
            router.push(`/studio/${draft.id}`);
        } catch (e) {
            setBusy(false);
            setError(e instanceof Error ? e.message : "Could not read that file.");
        }
    }

    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">New generator</h1>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Pick what your piece is built with. This can&apos;t be changed after you
                publish.
            </p>

            {detected && (
                <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    Read from your file: <strong>{getKind(kindId).label}</strong>, because{" "}
                    {detected}. Change it below if that is wrong.
                </p>
            )}

            <fieldset className="mt-6" disabled={busy}>
                <legend className="sr-only">Runtime kind</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                    {RUNTIME_KINDS.map((k) => (
                        <label
                            key={k.kindId}
                            className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                                kindId === k.kindId
                                    ? "border-alea-600 bg-alea-600/5"
                                    : "border-border hover:bg-accent"
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="kind"
                                    checked={kindId === k.kindId}
                                    onChange={() => setKindId(k.kindId)}
                                    className="accent-alea-600"
                                />
                                <span className="text-sm font-medium">{k.label}</span>
                            </span>
                            <span className="mt-1.5 block text-xs text-muted-foreground">
                                {k.blurb}
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="mt-8 flex flex-wrap gap-3">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void start("Untitled", templateFor(kindId))}
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    Start from a template
                </button>
                {/* A link, not a download. The button here used to hand over
                    whichever file the radio above happened to be on, so one
                    control produced four different things and named none of
                    them. */}
                <Link
                    href="/templates"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    Work locally instead
                </Link>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
                >
                    Open a .html or .zip
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void start("Untitled", BLANK, [])}
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
                >
                    Empty file
                </button>
            </div>

            <input
                ref={fileRef}
                type="file"
                accept=".html,.htm,.zip"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void fromFile(file);
                }}
            />

            {error && (
                <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {error}
                </p>
            )}

            <p className="mt-8 text-xs text-muted-foreground">
                Your piece should draw from its seed and nothing else. We&apos;ll check
                that before you publish.
            </p>
        </div>
    );
}

const BLANK = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;height:100%}canvas{display:block}</style></head>
<body>
<canvas id="c"></canvas>
<script>
  // $alea.rand() is seeded from the piece's own seed. Math.random() is not,
  // and a piece that uses it renders differently everywhere it is drawn.
  const canvas = document.getElementById("c");
  const size = Math.min(innerWidth, innerHeight);
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, size, size);

  // Draw here.

  // Tell the renderer this is the frame worth capturing.
  $alea.ready();
</script>
</body>
</html>
`;
