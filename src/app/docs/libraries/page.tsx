import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = {
    alternates: { canonical: "/docs/libraries" },
    title: "Libraries",
    description:
        "How a generator declares p5 or three.js instead of carrying a copy, what it costs, and what happens at every stage from your editor to the chain.",
    openGraph: {
        type: "website",
        title: "Libraries",
        description:
            "How a generator declares a library instead of carrying a copy, and why the record is a hash rather than a URL.",
    },
};

// Companion to ALEATORY-001 §1: that spec is written for implementers, this page for
// an artist who wants to know what to type and what's available.
export default function LibrariesPage() {
    return (
        <DocPage file="libraries.md">
            <Link href="/templates" className="underline hover:text-foreground">
                Starter kits
            </Link>
            <Link href="/docs/interface" className="underline hover:text-foreground">
                ALEATORY-001
            </Link>
        </DocPage>
    );
}
