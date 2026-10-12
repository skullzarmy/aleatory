"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads the next page when the reader approaches the end of this one.
 *
 * The first page is server rendered, so the grid is complete and indexable
 * before any of this runs, and everything here only ever appends. A reader
 * with no JavaScript, or a crawler, sees that first page and the link below
 * it.
 *
 * The sentinel sits a screen below the last card, so a page is usually
 * already there by the time the reader reaches where it goes.
 */
export function InfiniteScroll<T>({
    initial,
    initialCursor,
    load,
    children,
    label,
}: {
    initial: T[];
    /** Where the next page starts. Absent when the first page is the whole of it. */
    initialCursor?: string;
    /** Asks the server for the page after `cursor`. */
    load: (cursor: string) => Promise<{ items: T[]; cursor?: string }>;
    children: (items: T[]) => React.ReactNode;
    /** What is being counted, for the line at the end. */
    label: string;
}) {
    const [items, setItems] = useState(initial);
    const [cursor, setCursor] = useState(initialCursor);
    const [failed, setFailed] = useState(false);
    const sentinel = useRef<HTMLDivElement>(null);
    // A ref as well as state: the observer closes over whatever it saw when it
    // was created, and a request already in flight must not be sent twice
    // because the sentinel stayed on screen.
    const busy = useRef(false);

    const more = useCallback(async () => {
        if (busy.current || !cursor) return;
        busy.current = true;
        setFailed(false);
        try {
            // A page can be short, or empty, and still not be the end: the
            // server drops what a reader should not see and moves its cursor
            // past it. Nothing moves on screen when a page is empty, so the
            // observer will not fire again and this has to keep asking. The
            // cursor advances every time, which is what ends it.
            let at: string | undefined = cursor;
            let gained = 0;
            while (at && gained === 0) {
                const next: { items: T[]; cursor?: string } = await load(at);
                gained = next.items.length;
                at = next.cursor;
                if (gained > 0) {
                    // Appended, never replaced: the reader is somewhere in
                    // the list and replacing it moves what they are looking
                    // at.
                    setItems((prev) => [...prev, ...next.items]);
                }
            }
            setCursor(at);
        } catch {
            // An indexer refusing one page should leave the reader with the
            // pages they already have and a way to ask again.
            setFailed(true);
        } finally {
            busy.current = false;
        }
    }, [cursor, load]);

    useEffect(() => {
        const node = sentinel.current;
        if (!node || !cursor || failed) return;
        const io = new IntersectionObserver((entries) => entries[0].isIntersecting && void more(), {
            rootMargin: "800px",
        });
        io.observe(node);
        return () => io.disconnect();
    }, [more, cursor, failed]);

    return (
        <>
            {children(items)}

            {cursor && (
                <div ref={sentinel} className="py-8 text-center text-sm text-muted-foreground">
                    {failed ? (
                        <button
                            type="button"
                            onClick={() => void more()}
                            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
                        >
                            That did not load. Try again
                        </button>
                    ) : (
                        <span>Loading more</span>
                    )}
                </div>
            )}

            {!cursor && items.length > 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                    {items.length} {label}, which is all of them
                </p>
            )}
        </>
    );
}
