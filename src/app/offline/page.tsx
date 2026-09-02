import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Offline",
    robots: { index: false, follow: false },
};

/**
 * What the service worker serves when the network is gone.
 *
 * Static on purpose: it is cached at install and has to render with no chain,
 * no indexer and no gateway. Pieces already seen are still in the cache, so
 * "go back" is real advice rather than a shrug.
 */
export default function Offline() {
    return (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
            <p className="font-mono text-sm tracking-[0.3em] text-muted-foreground">OFFLINE</p>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">No connection</h1>
            <p className="mt-3 text-sm text-muted-foreground">
                Aleatory reads everything from the chain, so it needs a network to show you anything
                new. Pieces you have already looked at are still here.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link
                    href="/"
                    className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
                >
                    Try again
                </Link>
            </div>
        </div>
    );
}
