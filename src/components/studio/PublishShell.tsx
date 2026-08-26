"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDraft, type Draft } from "@/lib/draft";
import { validateSchema } from "@/lib/params";
import type { Provider } from "@/lib/providers";
import { DeployForm } from "./DeployForm";

/**
 * The last screen before a signature.
 *
 * A draft is checked here rather than trusted, because everything on the deploy
 * form marked permanent is permanent: a broken parameter declaration cannot be
 * corrected once a collection exists, and a generator that reaches the network
 * will not render the same way twice for anyone who ever holds a piece.
 */
export function PublishShell({ providers }: { providers: Provider[] }) {
    const params = useParams<{ draft: string }>();
    const id = params?.draft;
    const [draft, setDraft] = useState<Draft | null | undefined>(undefined);

    useEffect(() => {
        if (!id) return;
        void getDraft(id)
            .then(setDraft)
            .catch(() => setDraft(null));
    }, [id]);

    if (draft === undefined) {
        return (
            <p className="mx-auto max-w-2xl px-4 py-8 text-sm text-muted-foreground">
                Opening…
            </p>
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

    const errors = validateSchema(draft.params);

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
                Your generator, your contract, your terms. Anything marked permanent can
                never be changed.
            </p>

            {errors.length > 0 && (
                <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                    <p className="text-sm font-medium">
                        Fix your parameters first.
                    </p>
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
        </div>
    );
}
