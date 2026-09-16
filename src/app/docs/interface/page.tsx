import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = {
    alternates: { canonical: "/docs/interface" },
    openGraph: {
        type: "website",
        title: "ALEATORY-001",
        description:
            "The interface a generator conforms to so any provider renders it and any front end can list it.",
    },
    title: "ALEATORY-001",
    description:
        "The interface a generator conforms to so any provider renders it and any front end can list it.",
};

// Renders docs/interface.md directly, so there's one copy of the spec and it can't
// drift from the one in the repo.
export default function InterfacePage() {
    return (
        <DocPage file="interface.md">
            <Link href="/docs/params" className="underline hover:text-foreground">
                Parameters
            </Link>
            <Link href="/docs/libraries" className="underline hover:text-foreground">
                Libraries
            </Link>
            <Link href="/docs/provider" className="underline hover:text-foreground">
                Running a provider
            </Link>
        </DocPage>
    );
}
