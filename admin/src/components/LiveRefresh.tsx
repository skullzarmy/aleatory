"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * `router.refresh()` rather than a reload, so a half-typed withdrawal amount
 * survives the update. Paused while hidden, refreshed on the way back.
 */
export function LiveRefresh({ seconds = 30 }: { seconds?: number }) {
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
