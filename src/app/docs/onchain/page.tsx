import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = {
    alternates: { canonical: "/docs/onchain" },
    openGraph: {
        type: "website",
        title: "What is on chain",
        description:
            "What Aleatory means by on chain, one real piece taken apart to the bytes, and the commands to check it without trusting us.",
    },
    title: "What is on chain",
    description:
        "What Aleatory means by on chain, one real piece taken apart to the bytes, and the commands to check it without trusting us.",
};

// Renders docs/onchain.md directly, so the claim somebody reads here is the
// one in the repository, and the link at the foot lets them confirm that.
export default function OnchainPage() {
    return (
        <DocPage file="onchain.md">
            <Link href="/docs/interface" className="underline hover:text-foreground">
                ALEATORY-001
            </Link>
            <Link href="/contracts" className="underline hover:text-foreground">
                The contracts
            </Link>
        </DocPage>
    );
}
