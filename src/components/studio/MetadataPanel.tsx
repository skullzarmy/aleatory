"use client";

import { cloneElement, isValidElement, useId, type ReactElement } from "react";
import { checkDraftDetails, type Draft } from "@/lib/draft";
import type { ParamSpec } from "@/lib/params";
import { CoverPicker } from "./CoverPicker";
import { declaredIn } from "@/lib/libraries";

export function MetadataPanel({
    draft,
    params,
    deps,
    depsReady,
    depsError,
    onUpdate,
}: {
    draft: Draft;
    params: ParamSpec[];
    deps?: string[];
    depsReady: boolean;
    depsError: string | null;
    onUpdate: (patch: Partial<Draft>) => void;
}) {
    const status = checkDraftDetails(draft);

    return (
        <div className="mx-auto max-w-xl space-y-6 p-4">
            <div>
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold tracking-tight">Generator Details</h2>
                    <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                            status.complete
                                ? "border border-success/40 bg-success/10 text-success"
                                : "border border-destructive/40 bg-destructive/10 text-destructive"
                        }`}
                    >
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${
                                status.complete ? "bg-success" : "bg-destructive"
                            }`}
                            aria-hidden
                        />
                        {status.complete ? "Completed" : "Incomplete"}
                    </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    Set your generator&apos;s display metadata and cover image. These are saved
                    locally in your draft.
                </p>
            </div>

            <Field
                label="Generator name"
                hint="The collection title shown on Aleatory and marketplaces."
            >
                <input
                    value={draft.name}
                    onChange={(e) => onUpdate({ name: e.target.value })}
                    placeholder="Untitled"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            <Field
                label="Description"
                hint="Shown on your generator page and on every minted piece."
            >
                <textarea
                    value={draft.description ?? ""}
                    onChange={(e) => onUpdate({ description: e.target.value })}
                    rows={3}
                    placeholder="What the generator does, in a sentence or two."
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            <Field
                label="Tags"
                hint="Comma separated, e.g. generative, glitch, 3d. Used for discovery across marketplaces."
            >
                <input
                    value={(draft.tags ?? []).join(", ")}
                    onChange={(e) =>
                        onUpdate({
                            tags: e.target.value
                                .split(",")
                                .map((t) => t.trim())
                                .filter(Boolean),
                        })
                    }
                    placeholder="generative, canvas, abstract"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            <Field
                label="Name a piece from a trait (optional)"
                hint={
                    draft.nameTrait?.trim()
                        ? `Pieces will be named "${draft.name.trim() || "Generator"} #1 · <value of ${draft.nameTrait.trim()}>" when that trait is present.`
                        : 'Leave empty and every piece is named "Generator #1", "Generator #2". Fill in a key from $alea.features() to append it.'
                }
            >
                <input
                    value={draft.nameTrait ?? ""}
                    onChange={(e) => onUpdate({ nameTrait: e.target.value })}
                    placeholder="e.g. Palette"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            <Field
                label="Cover image"
                hint="Captured from your generator and pinned to IPFS. This is what represents your generator everywhere."
            >
                {depsError ? (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {depsError}
                    </p>
                ) : !depsReady ? (
                    <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                        Loading {declaredIn(draft.html).join(", ") || "libraries"}…
                    </p>
                ) : (
                    <CoverPicker
                        html={draft.html}
                        params={params}
                        deps={deps}
                        baseSeed={draft.cover?.seed ?? draft.seed}
                        initialCover={draft.cover}
                        onCaptured={(cover) => onUpdate({ cover: cover ?? undefined })}
                    />
                )}
            </Field>
        </div>
    );
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;

    const control = isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
              id: (children.props as { id?: string }).id ?? id,
              "aria-describedby":
                  (children.props as { "aria-describedby"?: string })["aria-describedby"] ?? hintId,
          })
        : children;

    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="text-sm font-medium">
                {label}
            </label>
            {control}
            {hint && (
                <p id={hintId} className="text-xs text-muted-foreground">
                    {hint}
                </p>
            )}
        </div>
    );
}
