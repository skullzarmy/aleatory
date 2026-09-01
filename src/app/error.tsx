"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorArt } from "@/components/brand/ErrorArt";
import { BRAND } from "@/lib/config";

/**
 * When a page throws.
 *
 * Without this file React unmounts the whole tree and Next prints
 * "Application error: a client-side exception has occurred", which tells a
 * visitor nothing and gives them nowhere to go.
 *
 * Every route here reads public chain state, so almost everything landing on
 * this screen is transient: an indexer that timed out, a gateway that was
 * slow, a network that dropped. Retrying is usually the whole fix, so it is
 * offered first.
 *
 * The piece behind the card is seeded by the digest, so one failure is one
 * picture: two people hitting the same bug see the same fracture, and fixing
 * it takes that piece out of the world.
 */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // The digest is the only handle on a minified stack, and the host keeps
        // the matching trace. Without it a report is "a page broke".
        console.error("[aleatory]", error.digest ?? "", error);
    }, [error]);

    return (
        <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-4 py-20">
            <ErrorArt seed={error.digest ?? error.message ?? "unknown"} />
            <div className="relative z-10 mx-auto max-w-lg rounded-xl border border-border bg-background/90 px-6 py-10 text-center shadow-xl backdrop-blur-md">
                <p className="font-mono text-sm tracking-[0.3em] text-muted-foreground">500</p>
                <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                    Something broke
                </h1>
                <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                    This page failed to read. The chain is untouched: every piece is stored
                    on it, and nothing here can change what is there. The fracture behind
                    this card was drawn from the fault itself.
                </p>

                {error.digest && (
                    <p className="mx-auto mt-6 max-w-full">
                        <span className="sr-only">Error reference: </span>
                        <code className="inline-block max-w-full truncate rounded border border-border bg-secondary px-2 py-1 align-middle font-mono text-xs text-foreground">
                            {error.digest}
                        </code>
                    </p>
                )}

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <button
                        type="button"
                        onClick={reset}
                        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        Try again
                    </button>
                    <Link
                        href="/"
                        className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        Back to recent
                    </Link>
                    <a
                        href={`${BRAND.repo}/issues`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        Report it
                    </a>
                </div>
            </div>
        </section>
    );
}
