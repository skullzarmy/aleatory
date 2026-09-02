import type { Metadata } from "next";
import Link from "next/link";
import { NotFoundArt, RequestedPath } from "@/components/brand/NotFoundArt";

export const metadata: Metadata = {
    title: "Not found",
    robots: { index: false, follow: false },
};

const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function NotFound() {
    return (
        <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-4 py-20">
            <NotFoundArt />
            <div className="relative z-10 mx-auto max-w-lg rounded-xl border border-border bg-background/90 px-6 py-10 text-center shadow-xl backdrop-blur-md">
                <p className="font-mono text-sm tracking-[0.3em] text-muted-foreground">404</p>
                <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                    Art not found
                </h1>
                {/* <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                    Every seed makes one piece and only one. This address isn’t one of them.
                </p> */}
                <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                    but the field behind this card was drawn from the path you asked for, so it
                    wasn't a total waste...
                </p>
                <RequestedPath />
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <Link
                        href="/"
                        className={`inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 ${focusRing}`}
                    >
                        Back to recent
                    </Link>
                    <Link
                        href="/about"
                        className={`inline-flex min-h-[44px] items-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary ${focusRing}`}
                    >
                        What this is
                    </Link>
                </div>
            </div>
        </section>
    );
}
