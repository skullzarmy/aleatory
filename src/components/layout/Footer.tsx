import Link from "next/link";
import { SiBluesky, SiDiscord, SiGithub, SiX } from "@icons-pack/react-simple-icons";
import { BRAND } from "@/lib/config";

/**
 * Grouped by who is reading, because a flat row of eight gives no clue which
 * one answers your question. Terms and Privacy sit on the bottom bar instead:
 * they are looked for by name, never browsed.
 */
const COLUMNS = [
    {
        heading: "Learn",
        links: [
            { href: "/about", label: "About" },
            { href: "/tezos", label: "New to Tezos" },
            { href: "/contracts", label: "Contracts" },
        ],
    },
    {
        heading: "Build on it",
        links: [
            { href: "/templates", label: "Starter kits" },
            { href: "/docs/interface", label: "ALEATORY-001" },
            { href: "/providers", label: "Render providers" },
        ],
    },
];

const LEGAL = [
    { href: "/terms", label: "Terms" },
    { href: "/terms/privacy", label: "Privacy" },
];

// Lucide (used elsewhere in the app) has no Discord icon, so all four marks
// here come from the same icon pack to keep a consistent weight.
//
// The labels are read now, not only announced, so they are the plain names
// rather than the sentences an icon on its own needed.
const ELSEWHERE = [
    { href: BRAND.repo, label: "GitHub", Icon: SiGithub },
    { href: BRAND.discord, label: "Discord", Icon: SiDiscord },
    { href: BRAND.x, label: "X", Icon: SiX },
    { href: BRAND.bluesky, label: "Bluesky", Icon: SiBluesky },
];

export function Footer() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-muted-foreground">
                <nav
                    aria-label="Footer"
                    className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3"
                >
                    {COLUMNS.map((column) => (
                        <div key={column.heading}>
                            <h2 className="text-xs font-medium uppercase tracking-wide text-foreground">
                                {column.heading}
                            </h2>
                            <ul className="mt-3 space-y-2">
                                {column.links.map((l) => (
                                    <li key={l.href}>
                                        <Link href={l.href} className="hover:text-foreground">
                                            {l.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}

                    <div className="col-span-2 sm:col-span-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-foreground">
                            Elsewhere
                        </h2>
                        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-1">
                            {ELSEWHERE.map(({ href, label, Icon }) => (
                                <li key={href}>
                                    <a
                                        href={href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 hover:text-foreground"
                                    >
                                        <Icon size={16} aria-hidden />
                                        {label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </nav>

                <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-baseline sm:justify-between">
                    <p>{BRAND.tagline}</p>
                    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-xs">
                        {LEGAL.map((l) => (
                            <Link key={l.href} href={l.href} className="hover:text-foreground">
                                {l.label}
                            </Link>
                        ))}
                        <p>
                            Created by{" "}
                            <a
                                href="https://skllzrmy.com/"
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-foreground"
                            >
                                skllzrmy.tez
                            </a>
                            , inspired by Piero.
                        </p>
                    </div>
                </div>
            </div>
        </footer>
    );
}
