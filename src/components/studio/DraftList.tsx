"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { deleteDraft, listDrafts, type Draft } from "@/lib/draft";
import { getKind } from "@/lib/runtimes";

/**
 * Everything the artist has open.
 *
 * Drafts live in this browser and nowhere else. That is what makes the studio
 * usable with no account and nothing of the artist's on our infrastructure, and
 * it is also why this page says out loud that clearing the browser loses the
 * work. A studio that quietly relies on IndexedDB is a studio that eats a piece
 * one day without warning.
 */
export function DraftList() {
    const [drafts, setDrafts] = useState<Draft[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void listDrafts()
            .then(setDrafts)
            .catch(() => setDrafts([]));
    }, []);

    async function remove(draft: Draft) {
        // Asked, because this is the only copy there is. A draft lives in this
        // browser and nowhere else: no server, no trash, no undo. The button
        // that does it sits an inch from the link that opens the piece.
        const name = draft.name || "Untitled";
        if (
            !window.confirm(
                `Delete "${name}"? It is only in this browser, so this cannot be undone.`,
            )
        ) {
            return;
        }
        setError(null);
        try {
            await deleteDraft(draft.id);
            setDrafts((d) => (d ?? []).filter((x) => x.id !== draft.id));
        } catch {
            // A silent rejection leaves the row sitting there, which reads as
            // nothing having happened. Say the delete failed.
            setError(
                `"${name}" could not be deleted. Another tab may be holding the draft store open.`,
            );
        }
    }

    if (drafts === null) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    if (drafts.length === 0) {
        return (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                    Nothing open. Start from a template, a file, or a blank page.
                </p>
                <Link
                    href="/studio/new"
                    className="mt-4 inline-block rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    New generator
                </Link>
            </div>
        );
    }

    return (
        <>
            {error && (
                <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {error}
                </p>
            )}
            <ul className="divide-y divide-border rounded-lg border border-border">
                {drafts.map((d) => (
                    <li key={d.id} className="flex items-center gap-4 px-4 py-3">
                        <Link href={`/studio/${d.id}`} className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                                {d.name || "Untitled"}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                                {getKind(d.kindId).label}
                                {" · "}
                                {new Intl.NumberFormat().format(
                                    new TextEncoder().encode(d.html).length,
                                )}{" "}
                                bytes
                                {" · "}
                                edited {relative(d.updatedAt)}
                            </span>
                        </Link>
                        <button
                            type="button"
                            onClick={() => void remove(d)}
                            aria-label={`Delete ${d.name || "Untitled"}`}
                            className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                            <Trash2 size={15} aria-hidden />
                        </button>
                    </li>
                ))}
            </ul>
        </>
    );
}

function relative(at: number): string {
    const seconds = Math.round((Date.now() - at) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}
