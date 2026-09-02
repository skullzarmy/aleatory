import type { Metadata } from "next";
import Link from "next/link";
import { DraftList } from "@/components/studio/DraftList";

export const metadata: Metadata = {
    alternates: { canonical: "/studio" },
    openGraph: {
        type: "website",
        title: "Studio",
        description: "Write a generator, read its space, prove it behaves, publish it.",
    },
    title: "Studio",
    description: "Write a generator, read its space, prove it behaves, publish it.",
};

export default function StudioPage() {
    return (
        <div className="mx-auto max-w-4xl px-4 py-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
                    <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                        Write a generator, explore what it makes, and publish it to a contract you
                        own.
                    </p>
                </div>
                <Link
                    href="/studio/new"
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    New generator
                </Link>
            </header>

            <section className="mt-8">
                <h2 className="mb-3 text-sm font-medium">Open drafts</h2>
                <DraftList />
                <p className="mt-3 text-xs text-muted-foreground">
                    Drafts are saved in this browser only. Export anything you&apos;d be sorry to
                    lose.
                </p>
            </section>

            <section className="mt-10 border-t border-border pt-6">
                <h2 className="text-sm font-medium">Already published</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    Change the price, pause sales, or shrink an edition on{" "}
                    <Link href="/manage" className="underline hover:text-foreground">
                        collections you own
                    </Link>
                    .
                </p>
            </section>
        </div>
    );
}
