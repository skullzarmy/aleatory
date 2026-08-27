import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { BRAND } from "@/lib/config";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = {
    alternates: { canonical: "/docs/interface" },
    openGraph: { type: "website", title: "ALEATORY-001", description: "The interface a collection conforms to so any provider renders it and any front end can list it." },
    title: "ALEATORY-001",
    description:
        "The interface a collection conforms to so any provider renders it and any front end can list it.",
};

/**
 * The interface spec, on the web.
 *
 * The point of publishing ALEATORY-001 is that somebody else can build against
 * it without our source, and asking them to read it in a git repository is
 * asking most of them not to. The page renders `docs/interface.md` directly, so
 * there is one copy of the spec and it cannot drift from the one in the repo.
 */
export default async function InterfacePage() {
    const source = await readFile(join(process.cwd(), "docs", "interface.md"), "utf8");
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

                    <p className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
                        This document is{" "}
                        <a
                            href={`${BRAND.repo}/blob/main/docs/interface.md`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-foreground"
                        >
                            docs/interface.md
                        </a>{" "}
                        in the repository. Our contracts are one implementation of it.
                    </p>
                </article>
            </div>
        </div>
    );
}
