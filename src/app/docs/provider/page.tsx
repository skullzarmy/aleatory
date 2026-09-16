import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = {
    alternates: { canonical: "/docs/provider" },
    title: "Running a render provider",
    description:
        "What a provider does, how to get listed, how artists find you, how you are paid, and what has to be in the environment.",
    openGraph: {
        type: "website",
        title: "Running a render provider",
        description:
            "Anyone can run one. The membership test is three views on a contract and listing is free.",
    },
};

// Linked from /providers and /providers/mine, which is where somebody decides
// to run one. Those pages used to send them to a file on GitHub mid-task.
export default function ProviderPage() {
    return (
        <DocPage file="provider.md">
            <Link href="/providers" className="underline hover:text-foreground">
                Render providers
            </Link>
            <Link href="/providers/mine" className="underline hover:text-foreground">
                Run one
            </Link>
        </DocPage>
    );
}
