import type { Metadata } from "next";
import Link from "next/link";
import { ContractLineage } from "@/components/ContractLineage";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    title: "Contracts",
    description:
        "Every contract this platform runs on, current and retired, read from the router on chain.",
    alternates: { canonical: "/contracts" },
    openGraph: {
        type: "website",
        title: "Contracts",
        description: "Every contract this platform runs on, read from the router on chain.",
    },
};

/**
 * What this platform is made of, and what it used to be made of.
 *
 * The claim the whole project rests on is that a piece survives us, which is
 * only checkable if the addresses are public. So they are all here, retired
 * ones included, each linked to an explorer that has no relationship to us.
 */
export default function ContractsPage() {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Contracts</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Everything this platform runs on, read from the router in your browser and linked to
                a block explorer. Retired contracts are listed too: a collection an old factory made
                is still owned by the artist who made it, and an old marketplace still holds the
                offers escrowed on it.
            </p>

            <ContractLineage />

            <section className="mt-12 rounded-lg border border-border p-6">
                <h2 className="text-base font-medium">Checking this yourself</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    Every address above comes from the router&apos;s storage and its history, which
                    anyone can read without asking us. The queries this page makes are in{" "}
                    <a
                        href={`${BRAND.repo}/blob/main/src/lib/router.ts`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-foreground"
                    >
                        the source
                    </a>
                    , and{" "}
                    <Link href="/docs/interface" className="underline hover:text-foreground">
                        ALEATORY-001
                    </Link>{" "}
                    describes what each contract has to do, so a piece resolves from chain state
                    whether or not this site is running.
                </p>
            </section>
        </div>
    );
}
