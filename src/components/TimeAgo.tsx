"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/utils";

/**
 * A relative time that keeps moving.
 *
 * Computed on the server, "17 seconds ago" is the age at the moment the page
 * was rendered, and a cached page repeats it to everyone who asks until it
 * revalidates. It reads as a clock that has stopped, which is worse than an
 * absolute timestamp would have been.
 *
 * So the server renders the absolute time and the browser turns it into a
 * relative one, updating on a schedule that matches the precision on screen:
 * every second while it says seconds, every minute after that.
 */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
    // The server pass has no clock the client agrees with, so it renders the
    // exact time and the first client paint replaces it. Both are correct,
    // which keeps hydration quiet.
    const [text, setText] = useState<string | null>(null);

    useEffect(() => {
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
        <time dateTime={iso} title={new Date(iso).toLocaleString()} className={className}>
            {text ?? new Date(iso).toLocaleDateString()}
        </time>
    );
}
