"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { ShareButtons, type ArtistHandles } from "@/components/ShareButtons";

/**
 * The moment after a mint, on the piece's own page. Marked by `?minted` on the
 * way in. Sits as an overlay notification under the header with a dismiss action.
 */
export function JustMinted({
    contract,
    remaining,
    shareUrl,
    shareText,
    artistHandles,
}: {
    contract: string;
    /** Unsold in the edition, or null for an open one. */
    remaining: number | null;
    shareUrl?: string;
    shareText?: string;
    artistHandles?: ArtistHandles;
}) {
    const params = useSearchParams();
    const [dismissed, setDismissed] = useState(false);
    const isMinted = params.has("minted");

    const dismiss = () => {
        setDismissed(true);
        if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.delete("minted");
            window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
        }
    };

    if (dismissed || !isMinted) return null;

    return (
        <div className="fixed inset-x-0 top-16 sm:top-20 z-30 pointer-events-none flex justify-center px-4 pt-3 sm:pt-4">
            <aside
                role="status"
                aria-label="Mint confirmation"
                className="pointer-events-auto max-h-[calc(100vh-5rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-alea-600/40 bg-background/95 p-4 shadow-2xl backdrop-blur-md animate-in fade-in-0 slide-in-from-top-2 duration-200"
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span
                            className="inline-flex h-2 w-2 rounded-full bg-alea-500 animate-pulse"
                            aria-hidden
                        />
                        <h2 className="text-sm font-semibold text-foreground">It&apos;s yours</h2>
                    </div>
                    <button
                        type="button"
                        onClick={dismiss}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Dismiss notification"
                    >
                        <X size={14} aria-hidden />
                        <span>Dismiss</span>
                    </button>
                </div>
                <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    Nobody has seen this before. It is drawn from the generator in the contract and
                    the seed your signature just fixed, and this page is where it lives from now on.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {remaining !== 0 && (
                        <Link
                            href={`/generator/${contract}`}
                            className="rounded-md bg-alea-600 px-3 py-1.5 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-alea-700"
                        >
                            Mint another
                            {remaining !== null && ` (${remaining} remaining)`}
                        </Link>
                    )}
                    <Link
                        href="/mine"
                        className="rounded-md border border-border px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors hover:bg-accent"
                    >
                        What you own
                    </Link>
                    <Link
                        href="/"
                        className="rounded-md border border-border px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors hover:bg-accent"
                    >
                        Other generators
                    </Link>
                </div>
                {shareUrl && shareText && (
                    <div className="mt-4 border-t border-alea-600/20 pt-3">
                        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                            Show it off
                        </p>
                        <ShareButtons
                            url={shareUrl}
                            text={shareText}
                            artistHandles={artistHandles}
                        />
                    </div>
                )}
            </aside>
        </div>
    );
}
