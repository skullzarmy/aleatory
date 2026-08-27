"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keep a server-rendered page current without a reload.
 *
 * Every page here is built on the server and revalidated on a timer, which
 * makes the *server* correct and leaves the screen stale until somebody
 * presses reload. Chain state moves on its own: a piece renders, an edition
 * sells out, a listing appears. None of that should need a keystroke.
 *
 * `router.refresh()` re-fetches the server components and reconciles in place,
 * so scroll position, focus, an open menu and anything else client-side
 * survive. It is not a reload and should not look like one.
 *
 * Paused while the tab is hidden. A background tab that keeps polling is a
 * background tab burning someone's battery and our indexer's rate limit to
 * update a page nobody is looking at, and the refresh on becoming visible
 * again is the one that actually matters.
 */
export function LiveRefresh({ seconds = 20 }: { seconds?: number }) {
    const router = useRouter();

    useEffect(() => {
        let timer: number | undefined;

        const stop = () => {
            if (timer !== undefined) window.clearInterval(timer);
            timer = undefined;
        };

        const start = () => {
            stop();
            timer = window.setInterval(() => router.refresh(), seconds * 1000);
        };

        function onVisibility() {
            if (document.hidden) {
                stop();
            } else {
                // Whatever changed while it was hidden, show it now rather
                // than after another full interval.
                router.refresh();
                start();
            }
        }

        if (!document.hidden) start();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [router, seconds]);

    return null;
}
