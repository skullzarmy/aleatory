import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/config";
import { renderMarkdown } from "@/lib/markdown";

/**
 * A document from `docs/`, rendered.
 *
 * The file is the page. Nothing is copied into a component, so the version
 * somebody reads here and the version in the repository cannot disagree, and
 * the link at the foot is there so a reader can check that for themselves.
 *
 * The contents list is built from the second-level headings, which is why the
 * documents that appear here are the ones written in sections. A document that
 * is one long run of prose reads worse on a page than in an editor, and belongs
 * in the repository rather than up here.
 */
export async function DocPage({
    file,
    children,
}: {
    /** Name inside `docs/`, with the extension. */
    file: string;
    /** Links for the foot of the page, before the source link. */
    children?: ReactNode;
}) {
    const source = await readFile(join(process.cwd(), "docs", file), "utf8");
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
                        {children}
                        <a
                            href={`${BRAND.repo}/blob/main/docs/${file}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-foreground"
                        >
                            docs/{file}
                        </a>
                    </div>
                </article>
            </div>
        </div>
    );
}
