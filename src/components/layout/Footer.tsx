import Link from "next/link";
import { BRAND } from "@/lib/config";

const LINKS = [
    { href: "/about", label: "About" },
    { href: "/tezos", label: "New to Tezos" },
    { href: "/templates", label: "Starter kits" },
    { href: "/docs/interface", label: "ALEATORY-001" },
    { href: "/terms", label: "Terms" },
    { href: "/terms/privacy", label: "Privacy" },
];

/**
 * The links were one unwrapping row, so on a phone the row overflowed and the
 * labels broke instead: "Source" ran off the edge while "New to Tezos" stacked
 * three words tall. Wrapping belongs between the links, never inside one, so
 * each is `whitespace-nowrap` and the row is allowed to wrap around them.
 */
export function Footer() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">
                <nav aria-label="Footer">
                    <ul className="flex flex-wrap gap-x-5 gap-y-3">
                        {LINKS.map((l) => (
                            <li key={l.href}>
                                <Link
                                    href={l.href}
                                    className="whitespace-nowrap hover:text-foreground"
                                >
                                    {l.label}
                                </Link>
                            </li>
                        ))}
                        <li>
                            <a
                                href={BRAND.repo}
                                target="_blank"
                                rel="noreferrer"
                                className="whitespace-nowrap hover:text-foreground"
                            >
                                Source
                            </a>
                        </li>
                    </ul>
                </nav>

                <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <p>{BRAND.tagline}</p>
                    <p className="text-xs">
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
        </footer>
    );
}
