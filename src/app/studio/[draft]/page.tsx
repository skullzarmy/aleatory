"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { getDraft, type Draft } from "@/lib/draft";
import { Workspace } from "@/components/studio/Workspace";

/**
 * One draft, opened.
 *
 * Drafts live in IndexedDB, so there is nothing to render on the server and
 * this page is a client component that loads by id. A draft that is not in this
 * browser is genuinely gone rather than merely unauthorized, and the page says
 * that instead of showing a spinner forever.
 */
export default function DraftPage({ params }: { params: Promise<{ draft: string }> }) {
    const { draft: id } = use(params);
    const [draft, setDraft] = useState<Draft | null | undefined>(undefined);

    useEffect(() => {
        void getDraft(id)
            .then((d) => setDraft(d))
            .catch(() => setDraft(null));
    }, [id]);

    if (draft === undefined) {
        return (
            <p className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground">
                Opening…
            </p>
        );
    }

    if (draft === null) {
        return (
            <div className="mx-auto max-w-md px-4 py-16 text-center">
                <h1 className="text-lg font-semibold">Not in this browser</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Drafts are saved in your browser. This one was made somewhere else, or
                    the browser data holding it was cleared.
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

    return <Workspace draft={draft} />;
}
