import Link from "next/link";
import { SiDiscord, SiGithub } from "@icons-pack/react-simple-icons";
import { BRAND } from "@/lib/config";

const LINKS = [
    { href: "/about", label: "About" },
    { href: "/tezos", label: "New to Tezos" },
    { href: "/templates", label: "Starter kits" },
    { href: "/docs/interface", label: "ALEATORY-001" },
    { href: "/contracts", label: "Contracts" },
    { href: "/terms", label: "Terms" },
    { href: "/terms/privacy", label: "Privacy" },
];

/**
 * Both marks come from one pack, so they are the same weight beside each
 * other. Lucide, which everything else here uses, carries GitHub and not
 * Discord, and a stroked outline next to a solid brand glyph reads as a
 * mistake at this size.
 */
const ELSEWHERE = [
    { href: BRAND.repo, label: "Source on GitHub", Icon: SiGithub },
    { href: BRAND.discord, label: "Discord", Icon: SiDiscord },
];

/**
 * Wrapping belongs between the links and never inside one, so each label is
 * `whitespace-nowrap` and the row wraps around them. Otherwise a phone breaks
 * "New to Tezos" three words tall while the row still overflows.
 */
export function Footer() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">
                <nav
                    aria-label="Footer"
                    className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4"
                >
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
                    </ul>

                    <ul className="flex items-center gap-1">
                        {ELSEWHERE.map(({ href, label, Icon }) => (
                            <li key={href}>
                                <a
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    // The label is the only name this link has,
                                    // and the padding is what makes an 18px
                                    // glyph a target a thumb can hit (2.5.8).
                                    aria-label={label}
                                    title={label}
                                    className="-m-1 inline-flex rounded-md p-2 hover:bg-accent hover:text-foreground"
                                >
                                    <Icon size={18} aria-hidden />
                                </a>
                            </li>
                        ))}
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
