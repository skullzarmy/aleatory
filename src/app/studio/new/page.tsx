"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getKind, RUNTIME_KINDS } from "@/lib/runtimes";
import { templateFor, templateParamsFor } from "@/lib/templates";
import { packageFromFile, packageFromHtml, type PackagedProject } from "@/lib/project";
import { detectKind, detectParams } from "@/lib/detect";
import { newDraft, saveDraft } from "@/lib/draft";
import type { ParamSpec } from "@/lib/params";

/**
 * Loading a generator.
 *
 * Three ways in, because artists arrive from three places: some want a running
 * piece to change, some have a folder of work already, some want an empty file.
 *
 * A `.zip` is inlined into a single document here rather than at publish, so
 * what runs in the studio is byte for byte what goes on chain. A preview built
 * from loose files and a publish built from a bundle are two different pieces.
 *
 * An uploaded file stops here rather than going straight through. What was read
 * out of it is a guess: the kind is inferred, the parameters are inferred, and a
 * zip may have left a file behind. This page already said "change it below if
 * that is wrong" over an editable list of kinds, and then navigated away before
 * anyone could read it, so the correction it offered could not be made and the
 * wrong guess was discovered later, in a studio panel that looked odd. Reading
 * the file and opening it are two steps now, and the second one is the artist's.
 */
/** A file that has been read, waiting on the artist to confirm what it says. */
/** A file that has been read and not yet opened. */
interface Held {
    name: string;
    project: PackagedProject;
}

export default function NewGeneratorPage() {
    const router = useRouter();
    const fileRef = useRef<HTMLInputElement>(null);
    const [kindId, setKindId] = useState(RUNTIME_KINDS[0].kindId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // What an uploaded file said about itself, shown rather than applied
    // quietly. A detected kind that is wrong should be visible and editable,
    // not discovered later by an artist wondering why the panel looks odd.
    //
    // The kind is held here alongside the reason rather than read back off the
    // selection, because the selection is the artist's answer and this is the
    // file's. Once the two can differ, rendering the selection here would put
    // their correction next to our evidence for something else: "read from your
    // file: p5.js, because it draws to a canvas".
    const [detected, setDetected] = useState<{
        kindId: number;
        /** False when nothing in the file matched and the fallback was used. */
        certain: boolean;
        kindBecause: string;
        paramsBecause: string | null;
        notes: string[];
    } | null>(null);
    // A file that has been read but not yet opened. Held rather than acted on,
    // because everything shown about it is still up for correction.
    const [opened, setOpened] = useState<Held | null>(null);

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
        setDetected(null);
        setOpened(null);
        try {
            const project = await packageFromFile(file);

            // The file already knows what it is. Asking the artist to pick the
            // kind again on the way back in is asking them to remember a
            // choice from the way out, and to be punished for misremembering.
            const guess = detectKind(project.html);
            setKindId(guess.kindId);

            const found = detectParams(project.html);
            setDetected({
                kindId: guess.kindId,
                certain: guess.certain,
                kindBecause: guess.because,
                paramsBecause: found
                    ? `${found.because} (${found.params.length} parameter${found.params.length === 1 ? "" : "s"})`
                    : null,
                // What reading the declaration cost. An artist who declared
                // seven and is given five cannot see the two that went missing
                // unless we say so.
                notes: found?.notes ?? [],
            });
            setOpened({ name: file.name.replace(/\.(html?|zip)$/i, ""), project });
            setBusy(false);
        } catch (e) {
            setBusy(false);
            setError(e instanceof Error ? e.message : "Could not read that file.");
        }
    }

    /** Open the held file, on whatever the artist has since corrected it to. */
    async function openHeld(held: Held) {
        setBusy(true);
        setError(null);
        try {
            // A file that declares its own parameters already carries them, so
            // nothing is written over them. One that declares none gets the
            // kind's defaults, on whatever kind the artist settled on.
            const draft = newDraft(
                held.name,
                kindId,
                held.project,
                detectParams(held.project.html) ? [] : templateParamsFor(kindId),
            );
            await saveDraft(draft);
            router.push(`/studio/${draft.id}`);
        } catch (e) {
            setBusy(false);
            setError(e instanceof Error ? e.message : "Could not open that.");
        }
    }

    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">New generator</h1>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Pick what your piece is built with. This can&apos;t be changed after you publish.
            </p>

            {/* `certain` is false when nothing in the file matched and the
                fallback was used. Saying "read from your file: Canvas 2D,
                because nothing in the file identified it" claims to have read
                something and admits there was nothing to read, in one sentence.
                A guess is worth showing; it is not worth dressing up as a
                finding, because the artist is the one who has to correct it. */}
            {detected && (
                <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    {detected.certain ? (
                        <>
                            Read from your file: <strong>{getKind(detected.kindId).label}</strong>,
                            because {detected.kindBecause}.
                        </>
                    ) : (
                        <>
                            Nothing in your file said which kind it is, so{" "}
                            <strong>{getKind(detected.kindId).label}</strong> is a guess.
                        </>
                    )}
                    {detected.paramsBecause && <> Also, {detected.paramsBecause}.</>} Change it
                    below if that is wrong.
                </p>
            )}

            {/* What reading the declaration cost, each loss on its own line. */}
            {detected?.notes.map((note) => (
                <p
                    key={note}
                    className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                >
                    {note}
                </p>
            ))}

            {/* What flattening the package cost, said before it is opened
                rather than never. A zip that referred to a file it did not
                contain used to arrive as a piece with a missing image and
                nothing anywhere explaining the hole. */}
            {opened && opened.project.unresolved.length > 0 && (
                <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {opened.project.unresolved.length === 1
                        ? "One file it refers to is not in the package: "
                        : `${opened.project.unresolved.length} files it refers to are not in the package: `}
                    <code className="font-mono text-xs">
                        {opened.project.unresolved.join(", ")}
                    </code>
                    . It will run without {opened.project.unresolved.length === 1 ? "it" : "them"}.
                </p>
            )}

            {opened?.project.notes.map((note) => (
                <p
                    key={note}
                    className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                >
                    {note}
                </p>
            ))}

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

            {/* While a file is held, the only things on offer are opening it
                and replacing it. Leaving "Start from a template" here would be
                a button that silently throws away the file just uploaded. */}
            <div className="mt-8 flex flex-wrap gap-3">
                {opened ? (
                    <>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => void openHeld(opened)}
                            className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                        >
                            Open in the studio
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => fileRef.current?.click()}
                            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
                        >
                            Choose a different file
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => void start("Untitled", templateFor(kindId))}
                            className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                        >
                            Start from a template
                        </button>
                        {/* A link, not a download: the kits page names each one
                            and says what it is for. */}
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
                    </>
                )}
            </div>

            <input
                ref={fileRef}
                type="file"
                accept=".html,.htm,.zip"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Cleared so that picking the same file again is still a
                    // change, which is what "Choose a different file" needs
                    // when the artist changes their mind and comes back.
                    e.target.value = "";
                    if (file) void fromFile(file);
                }}
            />

            {error && (
                <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {error}
                </p>
            )}

            <p className="mt-8 text-xs text-muted-foreground">
                Your piece should draw from its seed and nothing else. We&apos;ll check that before
                you publish.
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
