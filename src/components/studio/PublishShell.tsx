"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDraft, saveDraft, type Draft } from "@/lib/draft";
import { detectParams } from "@/lib/detect";
import { validateSchema } from "@/lib/params";
import type { Provider } from "@/lib/providers";
import { useDeps } from "@/components/useDeps";
import { DeployForm } from "./DeployForm";
import { PreflightModal } from "./PreflightModal";

// Validated here because a broken parameter declaration, once deployed, can't
// be corrected: the fields on the deploy form marked permanent are permanent.
export function PublishShell({ providers }: { providers: Provider[] }) {
    const params = useParams<{ draft: string }>();
    const id = params?.draft;
    const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
    const [showPreflight, setShowPreflight] = useState(false);
    const { deps } = useDeps(draft?.html ?? "");

    useEffect(() => {
        if (!id) return;
        void getDraft(id)
            .then(setDraft)
            .catch(() => setDraft(null));
    }, [id]);

    if (draft === undefined) {
        return (
            <p className="mx-auto max-w-2xl px-4 py-8 text-sm text-muted-foreground">Opening…</p>
        );
    }

    if (draft === null) {
        return (
            <div className="mx-auto max-w-md px-4 py-16 text-center">
                <h1 className="text-lg font-semibold">Not in this browser</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Drafts are saved in your browser, and this one is not in it.
                </p>
                <Link
                    href="/studio"
                    className="mt-6 inline-block rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    Back to the studio
                </Link>
            </div>
        );
    }

    const errors = validateSchema(detectParams(draft.html)?.params ?? []);

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link
                href={`/studio/${draft.id}`}
                className="text-xs text-muted-foreground underline hover:text-foreground"
            >
                Back to {draft.name || "the draft"}
            </Link>

            <h1 className="mt-3 text-xl font-semibold tracking-tight">Publish</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Your generator, your contract, your terms. Anything marked permanent can never be
                changed.
            </p>

            {draft.preflightPassedHtml !== draft.html && (
                <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                    <p className="text-sm font-medium">Pre-flight checks required</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        This generator has not passed pre-flight checks for its current code.
                        Passing checks is required before deploying.
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowPreflight(true)}
                        className="mt-3 inline-block rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
                    >
                        Run pre-flight checks
                    </button>
                </div>
            )}

            {errors.length > 0 && (
                <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                    <p className="text-sm font-medium">Fix your parameters first.</p>
                    <ul className="mt-2 space-y-1">
                        {errors.map((e) => (
                            <li key={e} className="text-xs leading-relaxed">
                                {e}
                            </li>
                        ))}
                    </ul>
                    <Link
                        href={`/studio/${draft.id}`}
                        className="mt-3 inline-block text-xs underline hover:text-foreground"
                    >
                        Go to parameters
                    </Link>
                </div>
            )}

            <div className="mt-8">
                <DeployForm providers={providers} draft={draft} />
            </div>

            <PreflightModal
                open={showPreflight}
                html={draft.html}
                seed={draft.seed}
                params={detectParams(draft.html)?.params ?? []}
                deps={deps}
                onClose={() => setShowPreflight(false)}
                onProceed={async () => {
                    const updated = { ...draft, preflightPassedHtml: draft.html };
                    setDraft(updated);
                    await saveDraft(updated);
                    setShowPreflight(false);
                }}
            />
        </div>
    );
}
