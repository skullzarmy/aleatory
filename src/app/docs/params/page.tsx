import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = {
    alternates: { canonical: "/docs/params" },
    title: "Mint-time parameters",
    description:
        "How a generator declares inputs a collector sets before they sign, how those values are resolved, and where they live on the token.",
    openGraph: {
        type: "website",
        title: "Mint-time parameters",
        description:
            "Up to five named inputs a collector chooses at mint, stored on the token beside the seed.",
    },
};

// The studio's parameter panel and our own mint form are both built from this
// document, and so is anyone else's: it is written so a different front end can
// build a mint UI for an Aleatory generator without reading our source.
export default function ParamsPage() {
    return (
        <DocPage file="params.md">
            <Link href="/docs/interface" className="underline hover:text-foreground">
                ALEATORY-001
            </Link>
            <Link href="/templates" className="underline hover:text-foreground">
                Starter kits
            </Link>
        </DocPage>
    );
}
