import Link from "next/link";

/**
 * Prev and next, as links, so a page is addressable and survives a reload.
 */
export function Pager({
    page,
    hasMore,
    href,
    showing,
}: {
    page: number;
    hasMore: boolean;
    /** Builds the URL for a page, keeping whatever else is in the query. */
    href: (page: number) => string;
    showing: string;
}) {
    if (page === 1 && !hasMore) return null;

    return (
        <nav
            aria-label="Pagination"
            className="mt-8 flex items-center justify-between gap-4 border-t border-border pt-6 text-sm"
        >
            {page > 1 ? (
                <Link
                    href={href(page - 1)}
                    rel="prev"
                    className="rounded-md border border-border px-3 py-2 hover:bg-accent"
                >
                    Newer
                </Link>
            ) : (
                <span />
            )}

            <p className="text-xs text-muted-foreground">{showing}</p>

            {hasMore ? (
                <Link
                    href={href(page + 1)}
                    rel="next"
                    className="rounded-md border border-border px-3 py-2 hover:bg-accent"
                >
                    Older
                </Link>
            ) : (
                <span />
            )}
        </nav>
    );
}
