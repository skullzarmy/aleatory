import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/config";
import { renderMarkdown } from "@/lib/markdown";

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

/**
 * The declaration mechanism, for the person using it.
 *
 * ALEATORY-001 §1 specifies it, correctly and for an implementer. That is the
 * wrong document for an artist who wants to know what to type, what is
 * available, and what happens if they get it wrong, and nothing answered that
 * anywhere.
 */
export default async function LibrariesPage() {
    const source = await readFile(join(process.cwd(), "docs", "libraries.md"), "utf8");
    const { html, headings } = renderMarkdown(source);
    const sections = headings.filter((h) => h.depth === 2);

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="gap-10 lg:flex">
                {sections.length > 0 && (
                    <nav className="mb-8 shrink-0 lg:sticky lg:top-24 lg:mb-0 lg:h-fit lg:w-56">
                        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Contents
                        </p>
                        <ul className="space-y-1.5">
                            {sections.map((h) => (
                                <li key={h.id}>
                                    <a
                                        href={`#${h.id}`}
                                        className="block text-xs leading-snug text-muted-foreground hover:text-foreground"
                                    >
                                        {h.text}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                )}

                <article className="min-w-0 max-w-3xl">
                    {/* Trusted input: a file in this repository, rendered by
                        our own renderer, which escapes everything it reads. */}
                    <div dangerouslySetInnerHTML={{ __html: html }} />

                    <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
                        <Link href="/templates" className="underline hover:text-foreground">
                            Starter kits
                        </Link>
                        <Link href="/docs/interface" className="underline hover:text-foreground">
                            ALEATORY-001
                        </Link>
                        <a
                            href={`${BRAND.repo}/blob/main/docs/libraries.md`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-foreground"
                        >
                            docs/libraries.md
                        </a>
                    </div>
                </article>
            </div>
        </div>
    );
}
