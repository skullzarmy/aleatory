"use client";

import { useEffect, useState } from "react";
import { timeAgo, timeAgoShort } from "@/lib/utils";

/**
 * A relative time that keeps moving. Computed on the server it is the age at
 * render, and a cached page repeats it until it revalidates, so the server
 * renders a fixed date and the browser makes it relative, updating at the
 * precision on screen.
 *
 * What the server renders has to be what the browser's first paint produces.
 * `toLocaleDateString()` is not: it reads the machine's locale and time zone,
 * so a server in UTC and a browser six hours behind disagree for six hours of
 * every day and React tears the page down over it. The date comes straight out
 * of the ISO string, and the locale-aware title is set once the browser is
 * rendering.
 */
export function TimeAgo({
    iso,
    className,
    /** What the time refers to, since a card carries no label to lean on. */
    prefix,
    /** Abbreviated units, for a line this has to share. */
    short = false,
}: {
    iso: string;
    className?: string;
    prefix?: string;
    short?: boolean;
}) {
    const [text, setText] = useState<string | null>(null);
    const [title, setTitle] = useState<string | undefined>(undefined);

    useEffect(() => {
        setTitle(new Date(iso).toLocaleString());
        function tick() {
            setText(short ? timeAgoShort(iso) : timeAgo(iso));
        }
        tick();

        const age = Date.now() - new Date(iso).getTime();
        const every = age < 60_000 ? 1_000 : 60_000;
        const id = window.setInterval(tick, every);
        return () => window.clearInterval(id);
    }, [iso, short]);

    return (
        <time dateTime={iso} title={title} className={className}>
            {prefix ? `${prefix} ` : ""}
            {text ?? iso.slice(0, 10)}
        </time>
    );
}
