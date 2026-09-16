import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    alternates: { canonical: "/docs" },
    title: "Docs",
    description:
        "The protocol Aleatory implements, how a generator declares libraries and parameters, and how to run a render provider.",
    openGraph: {
        type: "website",
        title: "Docs",
        description: "ALEATORY-001, libraries, parameters, and running a render provider.",
    },
};

/**
 * What is published, by who needs it.
 *
 * Four of the sixteen documents in the repository. The rest are ours: how this
 * is deployed, what was decided and why, what is still open. They are in the
 * repository because that is where somebody working on Aleatory reads them,
 * and putting them here would bury the four that a stranger actually needs.
 */
const DOCS = [
    {
        href: "/docs/interface",
        title: "ALEATORY-001",
        who: "For anyone building against it",
        blurb: "The protocol. What a generator is, what a piece is, what the chain holds, and what a renderer or a viewer has to do. Our contracts are one implementation of it, and it is written so they need not be yours.",
    },
    {
        href: "/docs/libraries",
        title: "Libraries",
        who: "For artists",
        blurb: "Declaring p5 or three.js instead of carrying a copy: what to type, what it costs, and why the record on chain is a hash rather than a link.",
    },
    {
        href: "/docs/params",
        title: "Parameters",
        who: "For artists, and anyone building a mint UI",
        blurb: "Up to five inputs a collector sets before they sign, stored on the token beside the seed. Written so another front end can build a mint form for an Aleatory generator without reading our source.",
    },
    {
        href: "/docs/provider",
        title: "Running a render provider",
        who: "For operators",
        blurb: "A provider draws the image for every piece minted from a generator that names it. Anyone can run one, listing is free, and this is what it takes.",
    },
];

export default function DocsPage() {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Docs</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Every page here is a file in the repository, rendered. There is one copy and it is
                the one our own code is built against.
            </p>

            <ul className="mt-8 space-y-px overflow-hidden rounded-lg border border-border bg-border">
                {DOCS.map((d) => (
                    <li key={d.href} className="bg-card-background">
                        <Link href={d.href} className="block p-5 transition-colors hover:bg-accent">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                                <h2 className="font-medium text-foreground">{d.title}</h2>
                                <span className="text-xs text-muted-foreground">{d.who}</span>
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                {d.blurb}
                            </p>
                        </Link>
                    </li>
                ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-4 text-sm">
                <Link href="/templates" className="underline hover:text-foreground">
                    Starter kits
                </Link>
                <a
                    href="/skill/SKILL.md"
                    className="underline hover:text-foreground"
                    title="The same guidance packaged for agents"
                >
                    Agent skills
                </a>
                <a
                    href={`${BRAND.repo}/tree/main/docs`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                >
                    Everything else, in the repository
                </a>
            </div>
        </div>
    );
}
