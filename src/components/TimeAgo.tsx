"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/utils";

/**
 * A relative time that keeps moving.
 *
 * Computed on the server, "17 seconds ago" is the age at the moment the page
 * was rendered, and a cached page repeats it to everyone who asks until it
 * revalidates. It reads as a clock that has stopped.
 *
 * So the server renders a fixed date and the browser turns it into a relative
 * one, updating on a schedule that matches the precision on screen: every
 * second while it says seconds, every minute after that.
 *
 * **What the server renders has to be something the browser's first paint
 * produces too.** `toLocaleDateString()` is not: it reads the machine's locale
 * and time zone, so a server in UTC and a browser six hours behind disagree
 * about the date for six hours of every day, and React tears the page down
 * over the mismatch. The date is written straight out of the ISO string,
 * which says the same thing everywhere, and the locale-aware title is set
 * once the browser is the one rendering.
 */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
    const [text, setText] = useState<string | null>(null);
    const [title, setTitle] = useState<string | undefined>(undefined);

    useEffect(() => {
        setTitle(new Date(iso).toLocaleString());
        function tick() {
            setText(timeAgo(iso));
        }
        tick();

        const age = Date.now() - new Date(iso).getTime();
        const every = age < 60_000 ? 1_000 : 60_000;
        const id = window.setInterval(tick, every);
        return () => window.clearInterval(id);
    }, [iso]);

    return (
        <time dateTime={iso} title={title} className={className}>
            {text ?? iso.slice(0, 10)}
        </time>
    );
}
