"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * The freshness policy, in one place.
 *
 * This site is a window onto chain state, and chain state moves on its own: a
 * piece renders, an edition sells out, a listing appears. A page that fetched
 * once at load is wrong within a minute and gives no sign of it.
 *
 * Paused while the tab is hidden, because a background tab polling all day is
 * somebody's battery, and the read that matters is the one on coming back. Same
 * on reconnecting: whatever happened during the outage is owed immediately, not
 * after another full interval.
 */
export function useLive(run: () => void, seconds: number) {
    // Held in a ref so a caller passing an inline function does not tear down
    // and rebuild the timer on every render.
    const latest = useRef(run);
    latest.current = run;

    useEffect(() => {
        let timer: number | undefined;

        const stop = () => {
            if (timer !== undefined) window.clearInterval(timer);
            timer = undefined;
        };

        const start = () => {
            stop();
            timer = window.setInterval(() => latest.current(), seconds * 1000);
        };

        const resume = () => {
            latest.current();
            start();
        };

        function onVisibility() {
            if (document.hidden) stop();
            else resume();
        }

        if (!document.hidden) start();
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("online", resume);
        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("online", resume);
        };
    }, [seconds]);
}

/**
 * The same policy for a server-rendered page. `router.refresh()` re-runs the
 * server components and reconciles in place, so scroll position, focus and an
 * open menu survive, and only what actually changed re-renders.
 *
 * This works only if the route is rendered per request. A page exporting
 * `revalidate` is a prerendered document, and the refresh below re-fetches that
 * same document from the CDN — the timer fires, nothing changes, and the page
 * stays stale until somebody reloads by hand.
 */
export function LiveRefresh({ seconds = 20 }: { seconds?: number }) {
    const router = useRouter();
    useLive(() => router.refresh(), seconds);
    return null;
}
