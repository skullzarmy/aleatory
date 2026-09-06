"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keep a server-rendered page current without a reload. Revalidation on a timer
 * makes the server correct and leaves the screen stale, while chain state moves
 * on its own: a piece renders, an edition sells out, a listing appears.
 *
 * `router.refresh()` re-fetches the server components and reconciles in place,
 * so scroll position, focus and an open menu survive.
 *
 * Paused while the tab is hidden, since the refresh that matters is the one on
 * becoming visible again.
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
